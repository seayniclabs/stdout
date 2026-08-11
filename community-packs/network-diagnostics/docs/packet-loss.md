# Network Packet Loss Diagnosis and Resolution

## Overview
Packet loss causes application timeouts, poor VoIP quality, and degraded user experience. This guide covers diagnosis at every layer.

## Symptoms of Packet Loss
- Intermittent connection failures
- High latency spikes
- Retransmissions in TCP connections
- Poor video/audio quality (VoIP, streaming)
- Slow file transfers despite high bandwidth

## Quick Diagnosis

### Ping Test
```bash
# Test packet loss to remote host
ping -c 100 example.com

# Look for:
# 100 packets transmitted, 95 received, 5% packet loss
```

Acceptable loss: <1% for most applications, <0.1% for VoIP

### MTR (My Traceroute)
```bash
# Continuous ping + traceroute
mtr -r -c 100 example.com

# Shows packet loss at each hop
```

### iPerf Bandwidth Test
```bash
# Server side
iperf3 -s

# Client side
iperf3 -c <server-ip> -t 60 -i 5

# Look for retransmissions
```

## Layer-by-Layer Diagnosis

### Layer 1: Physical Issues

#### Cable Problems
```bash
# Check interface errors
ip -s link show eth0

# Look for:
# RX errors: dropped, overrun, frame
# TX errors: dropped, carrier, collisions
```

Common causes:
- Damaged Ethernet cables
- Bad connectors (loose, corroded)
- Cable length >100m for Ethernet
- EMI (electromagnetic interference) near power lines

**Test:** Replace cable, test with known-good cable

#### Interface Speed Mismatch
```bash
# Check negotiated speed
ethtool eth0 | grep Speed
ethtool eth0 | grep Duplex

# Force specific speed (if auto-negotiation fails)
ethtool -s eth0 speed 1000 duplex full autoneg on
```

### Layer 2: Switch/Network Issues

#### Port Saturation
```bash
# Monitor interface bandwidth
iftop -i eth0
nload eth0

# Check for sustained >80% utilization
```

#### Switch Port Errors
Access switch management interface and check:
- CRC errors on port
- Input/output discards
- Buffer overflows
- Port flapping (up/down)

#### VLAN Misconfig
```bash
# Check VLAN assignments
ip link show | grep vlan
bridge vlan show
```

### Layer 3: Routing Issues

#### Routing Loops
```bash
# Check TTL decrements
traceroute -m 30 example.com

# Look for:
# - Same hops repeating
# - TTL expired in transit
```

#### Asymmetric Routing
```bash
# Trace path TO destination
traceroute example.com

# Trace path FROM destination (on remote host)
traceroute <your-ip>

# Different paths can cause stateful firewall drops
```

#### ICMP Rate Limiting
```bash
# Some routers rate-limit ICMP
# May show false packet loss for ping
# Test with TCP:
hping3 -S -p 80 -c 100 example.com
```

### Layer 4: Firewall/NAT Issues

#### Connection Tracking Table Full
```bash
# Check conntrack table usage (Linux)
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max

# If count ≈ max, increase limit
sysctl -w net.netfilter.nf_conntrack_max=262144
```

#### Firewall Drops
```bash
# Check dropped packets (iptables)
iptables -nvL | grep DROP
iptables -nvL -t nat | grep DROP

# Check firewall logs
journalctl -k | grep DROP
tail -f /var/log/syslog | grep UFW
```

## Network Interface Statistics

### Linux
```bash
# Detailed interface stats
netstat -i

# Packet drops by queue
cat /proc/net/softnet_stat

# Ring buffer stats
ethtool -S eth0 | grep -i drop
ethtool -S eth0 | grep -i error
```

### Increase Ring Buffer Size
```bash
# Check current size
ethtool -g eth0

# Increase (if supported)
ethtool -G eth0 rx 4096 tx 4096
```

## WiFi-Specific Issues

### Signal Strength
```bash
# Check WiFi signal (Linux)
iwconfig wlan0

# Look for:
# Link Quality=60/70  Signal level=-50 dBm
```

Signal levels:
- -30 dBm: Excellent
- -50 dBm: Good
- -60 dBm: Fair
- -70 dBm: Weak (expect packet loss)
- -80 dBm: Very weak

### Channel Interference
```bash
# Scan for nearby networks
iwlist wlan0 scan | grep -E 'ESSID|Channel|Quality'

# Change to less crowded channel
iwconfig wlan0 channel 6
```

### WiFi Driver Issues
```bash
# Check for WiFi driver errors
dmesg | grep -i wifi
dmesg | grep -i firmware

# Update WiFi driver (Ubuntu example)
sudo apt update
sudo apt install linux-firmware
```

## Common Fixes

### 1. Network Interface Tuning (Linux)
```bash
# Increase receive buffer
sysctl -w net.core.rmem_max=134217728
sysctl -w net.core.rmem_default=134217728

# Increase transmit buffer
sysctl -w net.core.wmem_max=134217728
sysctl -w net.core.wmem_default=134217728

# TCP tuning
sysctl -w net.ipv4.tcp_rmem="4096 87380 134217728"
sysctl -w net.ipv4.tcp_wmem="4096 65536 134217728"
sysctl -w net.ipv4.tcp_window_scaling=1
```

### 2. QoS/Traffic Shaping
```bash
# Prioritize low-latency traffic (Linux tc)
tc qdisc add dev eth0 root handle 1: prio bands 3

# VoIP traffic to high-priority band
tc filter add dev eth0 protocol ip parent 1:0 prio 1 \
  u32 match ip dport 5060 0xffff flowid 1:1
```

### 3. MTU Optimization
```bash
# Find path MTU
tracepath example.com

# Set interface MTU
ip link set dev eth0 mtu 1500

# Test different MTU sizes
ping -M do -s 1472 example.com  # 1472 + 28 = 1500
```

### 4. DNS Issues Appearing as Packet Loss
```bash
# If only DNS queries fail
# Test direct IP connection
ping 1.1.1.1

# If works, it's DNS not packet loss
# Change DNS server
echo "nameserver 1.1.1.1" > /etc/resolv.conf
```

## ISP/Upstream Issues

### Test to Multiple Destinations
```bash
# If loss only to one destination:
mtr google.com
mtr cloudflare.com
mtr <your-isp-dns>

# If loss to all destinations → local issue
# If loss only beyond ISP → ISP/upstream issue
```

### Contact ISP Checklist
Before calling ISP, gather:
- MTR report showing loss location
- Speed test results
- Time of day when issue occurs
- Duration of issue
- Modem signal levels (if cable/DSL)

## Monitoring for Packet Loss

### Smokeping
```bash
# Install Smokeping for continuous monitoring
apt install smokeping

# Configure targets in /etc/smokeping/config.d/Targets
```

### Grafana + Prometheus
```yaml
# Prometheus blackbox_exporter config
modules:
  icmp:
    prober: icmp
    timeout: 5s
    icmp:
      preferred_ip_protocol: ip4
```

Query packet loss:
```promql
rate(probe_icmp_duration_seconds_count[5m]) - 
rate(probe_success_count[5m])
```

## Prevention Checklist

- [ ] Monitor interface errors daily
- [ ] Set alerts for >1% packet loss
- [ ] Use redundant network paths when possible
- [ ] Regular cable quality checks
- [ ] Keep firmware updated (routers, switches, NICs)
- [ ] Document network topology
- [ ] Implement QoS for latency-sensitive applications
- [ ] Monitor bandwidth utilization
- [ ] Test failover paths quarterly

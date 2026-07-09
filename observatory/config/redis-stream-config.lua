-- Suricata EVE → Redis stream bootstrap (TOOL1).
--
-- Creates the consumer group used by StdOut's XREADGROUP loop:
--   stream key: eve_alerts
--   group:      stream
--
-- Prior lesson: do NOT use multi-minute BLOCK timeouts (600–1200s hang agent
-- sessions). StdOut uses short BLOCK (default 2000ms) and loops continuously;
-- Redis retains entries until XACK.
--
-- Usage (redis-cli --eval):
--   redis-cli --eval observatory/config/redis-stream-config.lua
--
-- Equivalent:
--   redis-cli --raw XGROUP CREATE eve_alerts stream 0 MKSTREAM

local stream = 'eve_alerts'
local group = 'stream'

local ok, err = pcall(function()
  return redis.call('XGROUP', 'CREATE', stream, group, '0', 'MKSTREAM')
end)

if ok then
  return { 'created', stream, group }
end

-- BUSYGROUP = already exists — treat as success.
if type(err) == 'string' and string.find(err, 'BUSYGROUP') then
  return { 'exists', stream, group }
end

return redis.error_reply(tostring(err))

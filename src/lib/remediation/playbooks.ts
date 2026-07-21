/**
 * Built-in Playbooks for Auto-Remediation
 *
 * These are standard playbooks that come pre-configured in StdOut
 * for common remediation scenarios.
 */

import { type Playbook } from './schema';

/**
 * Kubernetes Pod Restart Playbook
 * Restarts unhealthy pods in a deployment
 */
export const K8S_POD_RESTART: Playbook = {
  id: 'k8s-pod-restart',
  name: 'Kubernetes Pod Restart',
  description: 'Restart unhealthy pods in a Kubernetes deployment to resolve CrashLoopBackOff and other pod issues',
  trigger: {
    type: 'keyword',
    pattern: 'pod.*crashloopbackoff|pod.*not.*ready|pod.*pending|pod.*imagepullbackoff',
  },
  steps: [
    {
      id: 'get-pod-name',
      type: 'shell',
      description: 'Get the name of the unhealthy pod',
      command: 'kubectl get pods --sort-by=.metadata.creationTimestamp | grep -E "CrashLoop|ImagePull|Pending" | tail -1 | awk \'{print $1}\'',
      timeout: 10000,
    },
    {
      id: 'get-pod-namespace',
      type: 'shell',
      description: 'Get the namespace of the pod',
      command: 'kubectl get pods --all-namespaces --sort-by=.metadata.creationTimestamp | grep -E "CrashLoop|ImagePull|Pending" | tail -1 | awk \'{print $1}\'',
      timeout: 10000,
    },
    {
      id: 'delete-pod',
      type: 'shell',
      description: 'Delete the unhealthy pod (Kubernetes will restart it)',
      command: 'kubectl delete pod $(kubectl get pods --sort-by=.metadata.creationTimestamp | grep -E "CrashLoop|ImagePull|Pending" | tail -1 | awk \'{print $1}\') --namespace=default',
      timeout: 15000,
    },
    {
      id: 'wait-for-restart',
      type: 'wait',
      description: 'Wait for the new pod to start',
      timeout: 30000,
    },
    {
      id: 'verify-pod-running',
      type: 'verify',
      description: 'Verify the pod is now running',
      command: 'kubectl get pods -o jsonpath=\'{.items[0].status.phase}\'',
      expectedOutput: '^Running$',
      timeout: 10000,
    },
  ],
  rollback: [
    {
      id: 'rollback-restore',
      type: 'shell',
      description: 'Restore the previous deployment (if tracking is available)',
      command: 'kubectl rollout undo deployment/app',
      timeout: 30000,
      continueOnError: true,
    },
  ],
  requiresApproval: true,
  timeout: 120,
  riskLevel: 'medium',
  tags: ['kubernetes', 'pod', 'restart', 'crash-loop'],
  isBuiltIn: true,
  version: '1.0.0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Docker Container Restart Playbook
 * Restarts a Docker container that is in a failed state
 */
export const DOCKER_CONTAINER_RESTART: Playbook = {
  id: 'docker-container-restart',
  name: 'Docker Container Restart',
  description: 'Restart a failed or stuck Docker container',
  trigger: {
    type: 'keyword',
    pattern: 'container.*exited|docker.*error|container.*unhealthy|container.*crashed',
  },
  steps: [
    {
      id: 'get-container-id',
      type: 'shell',
      description: 'Get the ID of the failed container',
      command: 'docker ps -a --filter status=exited --format "{{.ID}}" | head -1',
      timeout: 10000,
    },
    {
      id: 'get-container-name',
      type: 'shell',
      description: 'Get the name of the failed container',
      command: 'docker ps -a --filter status=exited --format "{{.Names}}" | head -1',
      timeout: 10000,
    },
    {
      id: 'restart-container',
      type: 'shell',
      description: 'Restart the container',
      command: 'docker restart $(docker ps -a --filter status=exited --format "{{.ID}}" | head -1)',
      timeout: 15000,
    },
    {
      id: 'wait-for-container',
      type: 'wait',
      description: 'Wait for the container to fully start',
      timeout: 5000,
    },
    {
      id: 'verify-container-running',
      type: 'verify',
      description: 'Verify the container is now running',
      command: 'docker ps --filter status=running --format "table {{.ID}}"',
      expectedOutput: '^[a-f0-9]{12}',
      timeout: 10000,
    },
  ],
  rollback: [
    {
      id: 'rollback-stop',
      type: 'shell',
      description: 'Stop the container if restart caused issues',
      command: 'docker stop $(docker ps -a --filter status=exited --format "{{.ID}}" | head -1)',
      timeout: 10000,
      continueOnError: true,
    },
  ],
  requiresApproval: false,
  timeout: 90,
  riskLevel: 'low',
  tags: ['docker', 'container', 'restart'],
  isBuiltIn: true,
  version: '1.0.0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Clear Application Cache Playbook
 * Clears various application caches to resolve stale data issues
 */
export const CLEAR_CACHE: Playbook = {
  id: 'clear-cache',
  name: 'Clear Application Cache',
  description: 'Clear Redis, Memcached, or application-level caches to resolve stale data issues',
  trigger: {
    type: 'keyword',
    pattern: 'cache.*stale|cache.*corrupted|stale.*data|cache.*miss|cache.*expired',
  },
  steps: [
    {
      id: 'clear-redis',
      type: 'shell',
      description: 'Flush Redis cache (if available)',
      command: 'redis-cli FLUSHDB || echo "Redis not available"',
      timeout: 10000,
      continueOnError: true,
    },
    {
      id: 'clear-memcached',
      type: 'shell',
      description: 'Flush Memcached (if available)',
      command: 'echo "flush_all" | nc localhost 11211 || echo "Memcached not available"',
      timeout: 10000,
      continueOnError: true,
    },
    {
      id: 'clear-app-cache',
      type: 'api',
      description: 'Call application cache clear endpoint',
      endpoint: 'http://localhost:8080/api/cache/clear',
      method: 'POST',
      timeout: 15000,
      continueOnError: true,
    },
    {
      id: 'verify-cache-cleared',
      type: 'verify',
      description: 'Verify cache has been cleared',
      command: 'redis-cli DBSIZE',
      expectedOutput: '^\\{.*:0\\}',
      timeout: 10000,
      continueOnError: true,
    },
  ],
  rollback: [], // Cache clear is non-destructive, no rollback needed
  requiresApproval: false,
  timeout: 60,
  riskLevel: 'low',
  tags: ['cache', 'redis', 'memcached', 'performance'],
  isBuiltIn: true,
  version: '1.0.0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Scale Up Resources Playbook
 * Increases CPU/memory limits or replica count when resources are exhausted
 */
export const SCALE_UP_RESOURCES: Playbook = {
  id: 'scale-up-resources',
  name: 'Scale Up Resources',
  description: 'Increase resource allocation (CPU/memory) or replica count to resolve resource exhaustion',
  trigger: {
    type: 'keyword',
    pattern: 'out.*memory|oomkilled|cpu.*throttled|memory.*exhausted|resource.*limit|insufficient.*resource',
  },
  steps: [
    {
      id: 'check-pod-status',
      type: 'shell',
      description: 'Check current pod status and resource usage',
      command: 'kubectl top pods --all-namespaces',
      timeout: 10000,
    },
    {
      id: 'get-deployment',
      type: 'shell',
      description: 'Get the deployment name',
      command: 'kubectl get deployments -o name | head -1',
      timeout: 10000,
    },
    {
      id: 'scale-replicas',
      type: 'shell',
      description: 'Increase replica count by 1',
      command: 'DEPLOY=$(kubectl get deployments -o name | head -1) && kubectl scale --replicas=$(($($DEPLOY | awk \'{print $3}\') + 1)) $DEPLOY',
      timeout: 30000,
    },
    {
      id: 'wait-for-scaling',
      type: 'wait',
      description: 'Wait for new replicas to become ready',
      timeout: 30000,
    },
    {
      id: 'verify-scaling',
      type: 'verify',
      description: 'Verify new replicas are ready',
      command: 'kubectl get deployments -o jsonpath=\'{.items[0].status.readyReplicas}\'',
      expectedOutput: '^[0-9]+$',
      timeout: 10000,
    },
  ],
  rollback: [
    {
      id: 'scale-down',
      type: 'shell',
      description: 'Reduce replica count back to original if needed',
      command: 'DEPLOY=$(kubectl get deployments -o name | head -1) && kubectl scale --replicas=$(($($DEPLOY | awk \'{print $3}\') - 1)) $DEPLOY',
      timeout: 30000,
      continueOnError: true,
    },
  ],
  requiresApproval: true,
  timeout: 120,
  riskLevel: 'medium',
  tags: ['kubernetes', 'scaling', 'resources', 'memory', 'cpu'],
  isBuiltIn: true,
  version: '1.0.0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Restart Web Server Playbook
 * Restarts nginx, Apache, or other web servers to resolve connectivity issues
 */
export const RESTART_WEB_SERVER: Playbook = {
  id: 'restart-web-server',
  name: 'Restart Web Server',
  description: 'Restart nginx, Apache, or other web servers to resolve connectivity and performance issues',
  trigger: {
    type: 'keyword',
    pattern: 'web.*error|http.*error|502|503|connection.*refused|socket.*error|nginx.*error|apache.*error',
  },
  steps: [
    {
      id: 'detect-web-server',
      type: 'shell',
      description: 'Detect which web server is running',
      command: 'systemctl is-active nginx && echo "nginx" || (systemctl is-active apache2 && echo "apache2" || echo "unknown")',
      timeout: 10000,
    },
    {
      id: 'restart-server',
      type: 'shell',
      description: 'Restart the detected web server',
      command: 'SERVICE=$(systemctl is-active nginx && echo nginx || echo apache2) && systemctl restart $SERVICE',
      timeout: 30000,
    },
    {
      id: 'wait-for-startup',
      type: 'wait',
      description: 'Wait for server to fully start',
      timeout: 5000,
    },
    {
      id: 'verify-connectivity',
      type: 'verify',
      description: 'Verify server is responding to requests',
      command: 'curl -s -o /dev/null -w "%{http_code}" http://localhost/health',
      expectedOutput: '^(200|301)$',
      timeout: 10000,
    },
  ],
  rollback: [
    {
      id: 'rollback-restart',
      type: 'shell',
      description: 'Restart the web server again (or restore config)',
      command: 'systemctl restart nginx || systemctl restart apache2',
      timeout: 30000,
      continueOnError: true,
    },
  ],
  requiresApproval: false,
  timeout: 90,
  riskLevel: 'medium',
  tags: ['web-server', 'nginx', 'apache', 'connectivity', 'http'],
  isBuiltIn: true,
  version: '1.0.0',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Get all built-in playbooks
 */
export function getBuiltInPlaybooks(): Playbook[] {
  return [
    K8S_POD_RESTART,
    DOCKER_CONTAINER_RESTART,
    CLEAR_CACHE,
    SCALE_UP_RESOURCES,
    RESTART_WEB_SERVER,
  ];
}

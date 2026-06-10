/**
 * Observatory Setup Watcher
 *
 * Real-time monitoring of installation and configuration process
 * Shows progress, ETA, errors, and alerts as setup progresses
 */

export interface SetupStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'complete' | 'error' | 'skipped';
  progress: number; // 0-100
  eta: number | null; // milliseconds remaining
  startTime: number | null;
  endTime: number | null;
  output: string[];
  errors: string[];
  warnings: string[];
}

export interface SetupState {
  steps: SetupStep[];
  currentStep: string | null;
  overallProgress: number; // 0-100
  totalEta: number | null; // milliseconds remaining
  status: 'idle' | 'running' | 'complete' | 'error';
  startTime: number | null;
  endTime: number | null;
}

export type SetupEventType = 'step_start' | 'step_progress' | 'step_complete' | 'step_error' | 'output' | 'warning' | 'error';

export interface SetupEvent {
  type: SetupEventType;
  stepId: string;
  timestamp: number;
  message?: string;
  progress?: number;
  eta?: number;
  error?: string;
}

export class SetupWatcher {
  private state: SetupState;
  private listeners: Array<(event: SetupEvent) => void> = [];

  constructor() {
    this.state = {
      steps: [
        {
          id: 'check_ollama',
          name: 'Check Ollama Installation',
          status: 'pending',
          progress: 0,
          eta: null,
          startTime: null,
          endTime: null,
          output: [],
          errors: [],
          warnings: []
        },
        {
          id: 'install_ollama',
          name: 'Install Ollama (if needed)',
          status: 'pending',
          progress: 0,
          eta: null,
          startTime: null,
          endTime: null,
          output: [],
          errors: [],
          warnings: []
        },
        {
          id: 'check_models',
          name: 'Check Required Models',
          status: 'pending',
          progress: 0,
          eta: null,
          startTime: null,
          endTime: null,
          output: [],
          errors: [],
          warnings: []
        },
        {
          id: 'pull_watcher',
          name: 'Download Watcher Model (Llama 3.2 3B)',
          status: 'pending',
          progress: 0,
          eta: null,
          startTime: null,
          endTime: null,
          output: [],
          errors: [],
          warnings: []
        },
        {
          id: 'pull_analyst',
          name: 'Download Analyst Model (Qwen 2.5 14B)',
          status: 'pending',
          progress: 0,
          eta: null,
          startTime: null,
          endTime: null,
          output: [],
          errors: [],
          warnings: []
        },
        {
          id: 'verify',
          name: 'Verify Installation',
          status: 'pending',
          progress: 0,
          eta: null,
          startTime: null,
          endTime: null,
          output: [],
          errors: [],
          warnings: []
        }
      ],
      currentStep: null,
      overallProgress: 0,
      totalEta: null,
      status: 'idle',
      startTime: null,
      endTime: null
    };
  }

  /**
   * Subscribe to setup events
   */
  onEvent(listener: (event: SetupEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: SetupEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  /**
   * Start a setup step
   */
  startStep(stepId: string): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.status = 'running';
    step.startTime = Date.now();
    step.progress = 0;

    this.state.currentStep = stepId;

    this.emit({
      type: 'step_start',
      stepId,
      timestamp: Date.now(),
      message: `Starting: ${step.name}`
    });

    this.updateOverallProgress();
  }

  /**
   * Update step progress
   */
  updateStepProgress(stepId: string, progress: number, eta?: number): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.progress = Math.min(100, Math.max(0, progress));
    if (eta !== undefined) {
      step.eta = eta;
    }

    this.emit({
      type: 'step_progress',
      stepId,
      timestamp: Date.now(),
      progress,
      eta
    });

    this.updateOverallProgress();
  }

  /**
   * Complete a step successfully
   */
  completeStep(stepId: string): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.status = 'complete';
    step.progress = 100;
    step.endTime = Date.now();
    step.eta = 0;

    this.emit({
      type: 'step_complete',
      stepId,
      timestamp: Date.now(),
      message: `Completed: ${step.name}`
    });

    this.updateOverallProgress();
  }

  /**
   * Skip a step (not needed)
   */
  skipStep(stepId: string, reason: string): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.status = 'skipped';
    step.progress = 100;
    step.endTime = Date.now();
    step.output.push(`Skipped: ${reason}`);

    this.emit({
      type: 'step_complete',
      stepId,
      timestamp: Date.now(),
      message: `Skipped: ${step.name} (${reason})`
    });

    this.updateOverallProgress();
  }

  /**
   * Mark step as error
   */
  errorStep(stepId: string, error: string): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.status = 'error';
    step.endTime = Date.now();
    step.errors.push(error);

    this.emit({
      type: 'step_error',
      stepId,
      timestamp: Date.now(),
      error,
      message: `Error in ${step.name}: ${error}`
    });

    this.state.status = 'error';
    this.updateOverallProgress();
  }

  /**
   * Add output line to step
   */
  addOutput(stepId: string, message: string): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.output.push(message);

    this.emit({
      type: 'output',
      stepId,
      timestamp: Date.now(),
      message
    });
  }

  /**
   * Add warning to step
   */
  addWarning(stepId: string, warning: string): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.warnings.push(warning);

    this.emit({
      type: 'warning',
      stepId,
      timestamp: Date.now(),
      message: warning
    });
  }

  /**
   * Update overall progress and ETA
   */
  private updateOverallProgress(): void {
    const totalSteps = this.state.steps.length;
    const completedSteps = this.state.steps.filter(
      s => s.status === 'complete' || s.status === 'skipped'
    ).length;
    const runningStep = this.state.steps.find(s => s.status === 'running');

    // Calculate overall progress
    let overallProgress = (completedSteps / totalSteps) * 100;

    if (runningStep) {
      // Add partial progress from running step
      overallProgress += (runningStep.progress / 100) * (100 / totalSteps);
    }

    this.state.overallProgress = Math.min(100, overallProgress);

    // Calculate total ETA
    if (runningStep && runningStep.eta) {
      const remainingSteps = this.state.steps.filter(s => s.status === 'pending').length;
      const avgStepTime = 60000; // Assume 60s per step
      this.state.totalEta = runningStep.eta + (remainingSteps * avgStepTime);
    } else {
      this.state.totalEta = null;
    }

    // Check if all complete
    if (completedSteps === totalSteps) {
      this.state.status = 'complete';
      this.state.endTime = Date.now();
      this.state.currentStep = null;
      this.state.totalEta = 0;
    }
  }

  /**
   * Get current state
   */
  getState(): SetupState {
    return JSON.parse(JSON.stringify(this.state)); // Deep clone
  }

  /**
   * Start the setup process
   */
  start(): void {
    this.state.status = 'running';
    this.state.startTime = Date.now();
  }

  /**
   * Get formatted ETA string
   */
  static formatETA(ms: number | null): string {
    if (ms === null || ms === 0) return 'Complete';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `~${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `~${minutes}m ${seconds % 60}s`;
    } else {
      return `~${seconds}s`;
    }
  }

  /**
   * Get formatted duration
   */
  static formatDuration(startTime: number | null, endTime: number | null): string {
    if (!startTime) return 'Not started';
    const end = endTime || Date.now();
    const ms = end - startTime;
    return this.formatETA(ms);
  }
}

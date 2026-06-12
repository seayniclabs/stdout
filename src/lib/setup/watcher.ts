/**
 * StdOut Installation Watcher
 *
 * Monitors entire installation process with real-time progress, ETA, and alerts
 */

import type { InstallStep } from './installer';
import { INSTALL_STEPS } from './installer';

export interface WatchedStep extends InstallStep {
  status: 'pending' | 'running' | 'complete' | 'error' | 'skipped';
  progress: number; // 0-100
  eta: number | null; // milliseconds remaining
  startTime: number | null;
  endTime: number | null;
  output: string[];
  warnings: string[];
  errors: string[];
}

export interface InstallState {
  steps: WatchedStep[];
  currentStepId: string | null;
  overallProgress: number; // 0-100
  totalEta: number | null; // milliseconds
  status: 'idle' | 'running' | 'complete' | 'error';
  startTime: number | null;
  endTime: number | null;
  skipOptional: boolean;
}

export type InstallEventType =
  | 'install_start'
  | 'install_complete'
  | 'step_start'
  | 'step_progress'
  | 'step_complete'
  | 'step_skip'
  | 'step_error'
  | 'output'
  | 'warning'
  | 'error';

export interface InstallEvent {
  type: InstallEventType;
  stepId?: string;
  timestamp: number;
  message?: string;
  progress?: number;
  eta?: number;
  error?: string;
}

export class InstallWatcher {
  private state: InstallState;
  private listeners: Array<(event: InstallEvent) => void> = [];

  constructor(skipOptional: boolean = false) {
    this.state = {
      steps: INSTALL_STEPS.map(step => ({
        ...step,
        status: 'pending',
        progress: 0,
        eta: null,
        startTime: null,
        endTime: null,
        output: [],
        warnings: [],
        errors: []
      })),
      currentStepId: null,
      overallProgress: 0,
      totalEta: null,
      status: 'idle',
      startTime: null,
      endTime: null,
      skipOptional
    };
  }

  /**
   * Subscribe to installation events
   */
  onEvent(listener: (event: InstallEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: InstallEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[InstallWatcher] Listener error:', error);
      }
    });
  }

  /**
   * Start installation
   */
  start(): void {
    this.state.status = 'running';
    this.state.startTime = Date.now();

    this.emit({
      type: 'install_start',
      timestamp: Date.now(),
      message: 'StdOut installation started'
    });

    this.calculateTotalEta();
  }

  /**
   * Start a step
   */
  startStep(stepId: string): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.status = 'running';
    step.startTime = Date.now();
    step.progress = 0;
    step.eta = step.estimatedSeconds * 1000;

    this.state.currentStepId = stepId;

    this.emit({
      type: 'step_start',
      stepId,
      timestamp: Date.now(),
      message: `Starting: ${step.name}`,
      eta: step.eta
    });

    this.updateOverallProgress();
  }

  /**
   * Update step progress
   */
  updateProgress(stepId: string, progress: number, message?: string): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.progress = Math.min(100, Math.max(0, progress));

    // Calculate ETA based on progress
    if (step.startTime && progress > 0 && progress < 100) {
      const elapsed = Date.now() - step.startTime;
      const estimatedTotal = (elapsed / progress) * 100;
      step.eta = Math.max(0, estimatedTotal - elapsed);
    }

    if (message) {
      step.output.push(message);
    }

    this.emit({
      type: 'step_progress',
      stepId,
      timestamp: Date.now(),
      progress,
      eta: step.eta ?? undefined,
      message
    });

    this.updateOverallProgress();
  }

  /**
   * Complete a step
   */
  completeStep(stepId: string, result: { output: string[]; warnings: string[]; errors: string[] }): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.status = result.errors.length > 0 ? 'error' : 'complete';
    step.progress = 100;
    step.endTime = Date.now();
    step.eta = 0;
    step.output.push(...result.output);
    step.warnings.push(...result.warnings);
    step.errors.push(...result.errors);

    this.emit({
      type: step.status === 'error' ? 'step_error' : 'step_complete',
      stepId,
      timestamp: Date.now(),
      message: step.status === 'error'
        ? `Failed: ${step.name}`
        : `Completed: ${step.name}`,
      error: result.errors[0]
    });

    // Emit warnings
    result.warnings.forEach(warning => {
      this.emit({
        type: 'warning',
        stepId,
        timestamp: Date.now(),
        message: warning
      });
    });

    this.state.currentStepId = null;
    this.updateOverallProgress();
  }

  /**
   * Skip a step
   */
  skipStep(stepId: string, reason: string): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.status = 'skipped';
    step.progress = 100;
    step.endTime = Date.now();
    step.output.push(`Skipped: ${reason}`);

    this.emit({
      type: 'step_skip',
      stepId,
      timestamp: Date.now(),
      message: `Skipped: ${step.name} (${reason})`
    });

    this.updateOverallProgress();
  }

  /**
   * Add output to current step
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
   * Add warning to current step
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
   * Add error to current step
   */
  addError(stepId: string, error: string): void {
    const step = this.state.steps.find(s => s.id === stepId);
    if (!step) return;

    step.errors.push(error);

    this.emit({
      type: 'error',
      stepId,
      timestamp: Date.now(),
      error
    });
  }

  /**
   * Update overall progress and ETA
   */
  private updateOverallProgress(): void {
    const allSteps = this.state.steps;
    const totalSteps = allSteps.length;

    // Weight by estimated time
    const totalEstimatedTime = allSteps.reduce((sum, s) => sum + s.estimatedSeconds, 0);

    let completedTime = 0;
    let currentStepPartialTime = 0;

    for (const step of allSteps) {
      if (step.status === 'complete' || step.status === 'skipped') {
        completedTime += step.estimatedSeconds;
      } else if (step.status === 'running') {
        currentStepPartialTime = step.estimatedSeconds * (step.progress / 100);
      }
    }

    this.state.overallProgress = Math.min(100,
      ((completedTime + currentStepPartialTime) / totalEstimatedTime) * 100
    );

    // Calculate total ETA
    const runningStep = allSteps.find(s => s.status === 'running');
    if (runningStep && runningStep.eta) {
      const remainingSteps = allSteps.filter(s => s.status === 'pending');
      const remainingTime = remainingSteps.reduce((sum, s) => sum + (s.estimatedSeconds * 1000), 0);
      this.state.totalEta = runningStep.eta + remainingTime;
    } else {
      const pendingSteps = allSteps.filter(s => s.status === 'pending');
      if (pendingSteps.length > 0) {
        this.state.totalEta = pendingSteps.reduce((sum, s) => sum + (s.estimatedSeconds * 1000), 0);
      } else {
        this.state.totalEta = 0;
      }
    }

    // Check if all done
    const allDone = allSteps.every(s =>
      s.status === 'complete' || s.status === 'skipped' || s.status === 'error'
    );

    if (allDone) {
      this.complete();
    }
  }

  /**
   * Calculate initial total ETA
   */
  private calculateTotalEta(): void {
    const stepsToRun = this.state.skipOptional
      ? this.state.steps.filter(s => s.required)
      : this.state.steps;

    this.state.totalEta = stepsToRun.reduce((sum, s) => sum + (s.estimatedSeconds * 1000), 0);
  }

  /**
   * Complete installation
   */
  private complete(): void {
    this.state.status = 'complete';
    this.state.endTime = Date.now();
    this.state.currentStepId = null;
    this.state.overallProgress = 100;
    this.state.totalEta = 0;

    const hasErrors = this.state.steps.some(s => s.status === 'error' && s.required);

    this.emit({
      type: 'install_complete',
      timestamp: Date.now(),
      message: hasErrors
        ? 'Installation completed with errors'
        : 'Installation completed successfully'
    });
  }

  /**
   * Get current state
   */
  getState(): InstallState {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Get summary
   */
  getSummary(): {
    duration: number;
    totalSteps: number;
    completed: number;
    skipped: number;
    errors: number;
    warnings: number;
  } {
    const duration = this.state.endTime && this.state.startTime
      ? this.state.endTime - this.state.startTime
      : 0;

    return {
      duration,
      totalSteps: this.state.steps.length,
      completed: this.state.steps.filter(s => s.status === 'complete').length,
      skipped: this.state.steps.filter(s => s.status === 'skipped').length,
      errors: this.state.steps.reduce((sum, s) => sum + s.errors.length, 0),
      warnings: this.state.steps.reduce((sum, s) => sum + s.warnings.length, 0)
    };
  }

  /**
   * Format ETA as human-readable string
   */
  static formatETA(ms: number | null): string {
    if (ms === null || ms <= 0) return 'Calculating...';

    const seconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `~${hours}h ${remainingMinutes}m`;
    } else if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `~${minutes}m ${remainingSeconds}s`;
    } else {
      return `~${seconds}s`;
    }
  }

  /**
   * Format duration
   */
  static formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);

    if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

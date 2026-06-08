// Setup wizard state management - v2
import { nanoid } from 'nanoid';
import { getCentralDb } from './db';
import { setupProgress, setupConfig, users, license } from './db/central-schema';
import { eq, desc } from 'drizzle-orm';

export enum SetupStep {
  AdminAccount = 1,
  Environment = 2,
  License = 3,
  Scanner = 4,
  Review = 5,
  Windlass = 6,
  Complete = 7,
}

export const STEP_NAMES: Record<SetupStep, string> = {
  [SetupStep.AdminAccount]: 'Create Admin Account',
  [SetupStep.Environment]: 'Name Environment',
  [SetupStep.License]: 'Activate License',
  [SetupStep.Scanner]: 'Discover Infrastructure',
  [SetupStep.Review]: 'Review Environment',
  [SetupStep.Windlass]: 'Configure Windlass',
  [SetupStep.Complete]: 'Complete',
};

export interface SetupState {
  currentStep: SetupStep;
  totalSteps: number;
  completed: boolean;
  steps: Array<{
    number: SetupStep;
    name: string;
    completed: boolean;
    completedAt?: Date;
    data?: any;
  }>;
}

/**
 * Get current setup progress
 */
export async function getSetupProgress(): Promise<SetupState> {
  const db = getCentralDb();

  // Get all completed steps
  let steps = await db.select().from(setupProgress).orderBy(setupProgress.stepNumber);

  // Initialize setup_progress if empty
  if (steps.length === 0) {
    const now = new Date();
    for (let step = SetupStep.AdminAccount; step <= SetupStep.Complete; step++) {
      await db.insert(setupProgress).values({
        id: nanoid(),
        stepNumber: step,
        stepName: STEP_NAMES[step],
        completed: false,
        completedAt: null,
        data: null,
        createdAt: now,
      });
    }
    // Re-fetch after initialization
    steps = await db.select().from(setupProgress).orderBy(setupProgress.stepNumber);
  }

  // Find first incomplete step
  let currentStep = SetupStep.AdminAccount;
  for (let step = SetupStep.AdminAccount; step <= SetupStep.Complete; step++) {
    const stepProgress = steps.find(s => s.stepNumber === step);
    if (!stepProgress || !stepProgress.completed) {
      currentStep = step;
      break;
    }
  }

  const isComplete = currentStep === SetupStep.Complete;

  return {
    currentStep: isComplete ? SetupStep.Complete : currentStep,
    totalSteps: Object.keys(SetupStep).length / 2, // Enum has both number and string keys
    completed: isComplete,
    steps: Object.values(SetupStep)
      .filter(v => typeof v === 'number')
      .map(num => {
        const stepNum = num as SetupStep;
        const stepProgress = steps.find(s => s.stepNumber === stepNum);
        return {
          number: stepNum,
          name: STEP_NAMES[stepNum],
          completed: stepProgress?.completed || false,
          completedAt: stepProgress?.completedAt || undefined,
          data: stepProgress?.data ? JSON.parse(stepProgress.data) : undefined,
        };
      }),
  };
}

/**
 * Complete a setup step
 */
export async function completeStep(step: SetupStep, data?: any): Promise<void> {
  const db = getCentralDb();
  const now = new Date();

  // Check if step record exists
  const existing = await db
    .select()
    .from(setupProgress)
    .where(eq(setupProgress.stepNumber, step))
    .limit(1);

  if (existing.length > 0) {
    // Update existing record
    await db
      .update(setupProgress)
      .set({
        completed: true,
        completedAt: now,
        data: data ? JSON.stringify(data) : null,
      })
      .where(eq(setupProgress.stepNumber, step));
  } else {
    // Insert new record if it doesn't exist
    await db.insert(setupProgress).values({
      id: nanoid(),
      stepNumber: step,
      stepName: STEP_NAMES[step],
      completed: true,
      completedAt: now,
      data: data ? JSON.stringify(data) : null,
      createdAt: now,
    });
  }
}

/**
 * Check if setup is complete
 */
export async function isSetupComplete(): Promise<boolean> {
  const progress = await getSetupProgress();
  return progress.completed;
}

/**
 * Check if admin account exists (Step 1 complete)
 */
export async function hasAdminAccount(): Promise<boolean> {
  const db = getCentralDb();
  const user = await db.select().from(users).limit(1);
  return user.length > 0;
}

/**
 * Get setup config value
 */
export async function getSetupConfig(key: string): Promise<string | null> {
  const db = getCentralDb();
  const config = await db.select().from(setupConfig).where(eq(setupConfig.key, key)).limit(1);
  return config[0]?.value || null;
}

/**
 * Set setup config value
 */
export async function setSetupConfig(key: string, value: string): Promise<void> {
  const db = getCentralDb();
  const now = new Date();

  // Upsert
  const existing = await db.select().from(setupConfig).where(eq(setupConfig.key, key)).limit(1);

  if (existing.length > 0) {
    await db.update(setupConfig).set({ value, updatedAt: now }).where(eq(setupConfig.key, key));
  } else {
    await db.insert(setupConfig).values({
      key,
      value,
      updatedAt: now,
    });
  }
}

/**
 * Check if license is activated
 */
export async function hasActiveLicense(): Promise<boolean> {
  const db = getCentralDb();
  const lic = await db.select().from(license).limit(1);
  return lic.length > 0;
}

/** Pure progression rules for the five-step local NISAR processing workflow. */
export type ProcessingProgressInput = {
  areaReady: boolean;
  searchComplete: boolean;
  processingStarted: boolean;
  processingComplete: boolean;
  resultsLoaded: boolean;
  failed: boolean;
};
export type ProcessingProgress = ProcessingProgressInput & { activeStep: number; completedCount: number };

export function processingProgress(input: ProcessingProgressInput): ProcessingProgress {
  const done = [input.areaReady, input.searchComplete, input.processingStarted, input.processingComplete, input.resultsLoaded];
  const completedCount = done.filter(Boolean).length;
  let activeStep: number;
  if (!input.areaReady) activeStep = 1;
  else if (!input.searchComplete) activeStep = 2;
  else if (!input.processingStarted) activeStep = 3;
  else if (!input.processingComplete) activeStep = 4;
  else activeStep = 5;
  return { ...input, activeStep, completedCount };
}

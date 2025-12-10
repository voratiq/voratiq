import type {
  ConfirmationInteractor,
  ConfirmationInteractorOptions,
} from "../render/interactions/confirmation.js";
import { createConfirmationInteractor } from "../render/interactions/confirmation.js";
import { isInteractiveShell } from "../utils/terminal.js";

export interface ConfirmationWorkflowOptions {
  assumeYes?: boolean;
  onUnavailable: () => never;
  detectInteractive?: () => boolean;
  createInteractor?: (
    options: ConfirmationInteractorOptions,
  ) => ConfirmationInteractor;
}

export interface ConfirmationWorkflow {
  interactive: boolean;
  confirm: ConfirmationInteractor["confirm"];
  prompt: ConfirmationInteractor["prompt"];
  close: () => void;
}

export function createConfirmationWorkflow(
  options: ConfirmationWorkflowOptions,
): ConfirmationWorkflow {
  const {
    assumeYes = false,
    onUnavailable,
    detectInteractive = () => isInteractiveShell(),
    createInteractor: interactorFactory = (factoryOptions) =>
      createConfirmationInteractor(factoryOptions),
  } = options;

  const interactive = detectInteractive();
  if (!interactive && !assumeYes) {
    onUnavailable();
  }

  const interactor = interactorFactory({ assumeYes });

  return {
    interactive,
    confirm: interactor.confirm.bind(interactor),
    prompt: interactor.prompt.bind(interactor),
    close: () => interactor.close(),
  };
}

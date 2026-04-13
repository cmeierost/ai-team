export async function resolveRequestedBy(
  requestedBy: string | undefined,
  context:
    | {
        questionInput?: (options: {
          message: string;
          validate?: (value: string) => true | string;
        }) => Promise<string>;
      }
    | undefined,
  errorMessage: string
): Promise<string> {
  const explicitRequester = requestedBy?.trim();
  if (explicitRequester) {
    return explicitRequester;
  }

  if (context?.questionInput) {
    const response = await context.questionInput({
      message: 'Requested by (must be CEO/HR):',
      validate: (value) => value.trim().length > 0 || errorMessage,
    });
    if (response.trim()) {
      return response.trim();
    }
  }

  throw new Error(errorMessage);
}

export async function confirmGovernanceAction(
  approvedByUser: boolean | undefined,
  context:
    | {
        questionConfirm?: (options: {
          message: string;
          default?: boolean;
        }) => Promise<boolean>;
      }
    | undefined,
  message: string
): Promise<boolean> {
  if (typeof approvedByUser === 'boolean') {
    return approvedByUser;
  }

  if (context?.questionConfirm) {
    return context.questionConfirm({
      message,
      default: false,
    });
  }

  return false;
}

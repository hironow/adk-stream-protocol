/**
 * BIDI Mode - sendAutomaticallyWhen
 *
 * Wrapper for core sendAutomaticallyWhen logic with BIDI-specific logging.
 * See lib/core/send-automatically-when.ts for implementation details.
 */

import {
  sendAutomaticallyWhenCore,
  type SendAutomaticallyWhenOptions,
} from "@/lib/core/send-automatically-when";

export type { SendAutomaticallyWhenOptions };

/**
 * BIDI mode auto-send decision logic.
 * See lib/core/send-automatically-when.ts for detailed documentation.
 */
export function sendAutomaticallyWhen(
  options: SendAutomaticallyWhenOptions,
): boolean {
  return sendAutomaticallyWhenCore(options, (message) =>
    console.log(`[sendAutomaticallyWhen] ${message}`),
  );
}

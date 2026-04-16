import type { ListOperator } from "../../contracts/list.js";
import type { InteractiveSessionRecord } from "../../domain/interactive/model/types.js";
import type { MessageRecord } from "../../domain/message/model/types.js";
import type { ReductionRecord } from "../../domain/reduce/model/types.js";
import type { RunRecord } from "../../domain/run/model/types.js";
import type { SpecRecord } from "../../domain/spec/model/types.js";
import type { VerificationRecord } from "../../domain/verify/model/types.js";

export type ListRecord =
  | InteractiveSessionRecord
  | RunRecord
  | SpecRecord
  | MessageRecord
  | ReductionRecord
  | VerificationRecord;

export function getListRecordId(
  operator: ListOperator,
  record: ListRecord,
): string {
  if (operator === "run") {
    return (record as RunRecord).runId;
  }

  return (
    record as
      | InteractiveSessionRecord
      | SpecRecord
      | MessageRecord
      | ReductionRecord
      | VerificationRecord
  ).sessionId;
}

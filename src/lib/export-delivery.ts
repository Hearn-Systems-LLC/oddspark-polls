// Export delivery composition root. Poll Type registrations live here so the
// HTTP adapter and generic Results query stay closed to type-specific wiring.

import { createMultipleChoiceExportFactDriver } from "../adapters/d1/export/multiple-choice";
import { createOwnerExportPersistence } from "../adapters/d1/index";
import { multipleChoiceStrategy } from "../modules/polls/types/multiple-choice";
import {
  bindExportDriver,
  queryOwnerExport,
  type OwnerExport,
} from "../modules/results/export";
import type { ViewerContext } from "../modules/results/index";
import type { PollId } from "../shared/domain/index";

export function queryD1OwnerExport(
  db: D1Database,
  pollId: PollId,
  viewer: ViewerContext,
): Promise<OwnerExport | null> {
  return queryOwnerExport(
    createOwnerExportPersistence(db),
    pollId,
    viewer,
    [
      bindExportDriver(
        createMultipleChoiceExportFactDriver(db),
        multipleChoiceStrategy,
      ),
    ],
  );
}

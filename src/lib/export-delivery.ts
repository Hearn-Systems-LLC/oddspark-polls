// Export delivery composition root. Poll Type registrations live here so the
// HTTP adapter and generic Results query stay closed to type-specific wiring.

import {
  createBoundedMultipleChoiceExportFactDriver,
  createMultipleChoiceExportFactDriver,
} from "../adapters/d1/export/multiple-choice";
import {
  createBoundedRankedChoiceExportFactDriver,
  createRankedChoiceExportFactDriver,
} from "../adapters/d1/export/ranked-choice";
import { createOwnerExportPersistence } from "../adapters/d1/index";
import { multipleChoiceStrategy } from "../modules/polls/types/multiple-choice";
import { rankedChoiceStrategy } from "../modules/polls/types/ranked-choice";
import {
  bindBoundedExportDriver,
  bindExportDriver,
  queryBoundedOwnerExport,
  queryOwnerExport,
  type BoundedOwnerExport,
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
      bindExportDriver(
        createRankedChoiceExportFactDriver(db),
        rankedChoiceStrategy,
      ),
    ],
  );
}

export function queryD1BoundedOwnerExport(
  db: D1Database,
  pollId: PollId,
  viewer: ViewerContext,
): Promise<BoundedOwnerExport | null> {
  return queryBoundedOwnerExport(
    createOwnerExportPersistence(db),
    pollId,
    viewer,
    [
      bindBoundedExportDriver(
        createBoundedMultipleChoiceExportFactDriver(db),
        multipleChoiceStrategy,
      ),
      bindBoundedExportDriver(
        createBoundedRankedChoiceExportFactDriver(db),
        rankedChoiceStrategy,
      ),
    ],
  );
}

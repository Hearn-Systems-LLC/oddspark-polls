// Results-owned, format-neutral export query (AD-1/AD-9/AD-21). Ownership is
// resolved before a type-specific driver may read Vote, Comment, or Tally
// facts. Drivers remove persistence identifiers before a pure Poll Type
// strategy sees them; format adapters receive only the canonical tables.

import type {
  PollTypeExportCell,
  PollTypeExportProjection,
  PollTypeExportTable,
  Result,
} from "../../shared/application/index";
import type { PollId, PollType, UserId } from "../../shared/domain/index";
import { COMMENT_CAPS } from "../comments/index";
import type { ViewerContext } from "./index";

export type ExportOwnerEnvelope = {
  pollId: PollId;
  canonicalReference: string;
  pollType: PollType;
};

export type SharedExportVoteFacts = {
  /** Identifier-free sequence assigned only after the driver byte-orders rows. */
  alignmentKey: number;
  createdAtMs: number;
  comment: {
    body: string;
    displayName: string | null;
    createdAtMs: number;
  } | null;
};

export type ExportDriverFacts<TTypeFacts> = {
  sharedVotes: readonly SharedExportVoteFacts[];
  typeFacts: TTypeFacts;
};

export type ExportFactDriver<TTypeFacts> = {
  readonly type: PollType;
  projectFacts: (
    pollId: PollId,
  ) => Promise<ExportDriverFacts<TTypeFacts> | null>;
};

export type BoundedExportFactResult<TTypeFacts> =
  | { status: "ready"; facts: ExportDriverFacts<TTypeFacts> }
  | { status: "oversize" };

export type BoundedExportFactDriver<TTypeFacts> = {
  readonly type: PollType;
  projectFacts: (
    pollId: PollId,
  ) => Promise<BoundedExportFactResult<TTypeFacts> | null>;
};

export type ExportDriver = {
  readonly type: PollType;
  project: (
    pollId: PollId,
  ) => Promise<{
    sharedVotes: readonly SharedExportVoteFacts[];
    projection: PollTypeExportProjection;
  } | null>;
};

export type BoundedExportDriverResult =
  | {
      status: "ready";
      sharedVotes: readonly SharedExportVoteFacts[];
      projection: PollTypeExportProjection;
    }
  | { status: "oversize" };

export type BoundedExportDriver = {
  readonly type: PollType;
  project: (pollId: PollId) => Promise<BoundedExportDriverResult | null>;
};

/**
 * Bind a type-specific, ID-free fact reader to its required pure strategy.
 * The generic Results query can select this driver without learning the
 * Poll Type's facts or adding a type switch.
 */
export function bindExportDriver<TTypeFacts>(
  factDriver: ExportFactDriver<TTypeFacts>,
  strategy: {
    readonly type: PollType;
    readonly projectExport: (
      facts: TTypeFacts,
    ) => Result<PollTypeExportProjection>;
  },
): ExportDriver {
  if (factDriver.type !== strategy.type) {
    throw new Error("Mismatched Poll Type export driver");
  }
  return {
    type: factDriver.type,
    async project(pollId) {
      const facts = await factDriver.projectFacts(pollId);
      if (!facts) return null;
      const projected = strategy.projectExport(facts.typeFacts);
      if (!projected.ok) throw new Error(projected.error.code);
      return { sharedVotes: facts.sharedVotes, projection: projected.value };
    },
  };
}

/** Bind a capacity-aware fact reader without invoking Poll Type policy when oversized. */
export function bindBoundedExportDriver<TTypeFacts>(
  factDriver: BoundedExportFactDriver<TTypeFacts>,
  strategy: {
    readonly type: PollType;
    readonly projectExport: (
      facts: TTypeFacts,
    ) => Result<PollTypeExportProjection>;
  },
): BoundedExportDriver {
  if (factDriver.type !== strategy.type) {
    throw new Error("Mismatched Poll Type export driver");
  }
  return {
    type: factDriver.type,
    async project(pollId) {
      const result = await factDriver.projectFacts(pollId);
      if (!result || result.status === "oversize") return result;
      const projected = strategy.projectExport(result.facts.typeFacts);
      if (!projected.ok) throw new Error(projected.error.code);
      return {
        status: "ready",
        sharedVotes: result.facts.sharedVotes,
        projection: projected.value,
      };
    },
  };
}

export type CanonicalExportTable = PollTypeExportTable;

export type CanonicalExportDataset = {
  votes: CanonicalExportTable;
  tally: CanonicalExportTable;
  summary: CanonicalExportTable;
};

export type OwnerExport = {
  canonicalReference: string;
  dataset: CanonicalExportDataset;
};

export type BoundedOwnerExport =
  | { status: "ready"; export: OwnerExport }
  | { status: "oversize" };

export type ExportPorts = {
  findOwnerEnvelope: (
    pollId: PollId,
    ownerUserId: UserId,
  ) => Promise<ExportOwnerEnvelope | null>;
};

function validTimestamp(value: number): boolean {
  // RFC 3339 timestamps have a four-digit year. Validate before materializing
  // any canonical rows so extended-year ISO output (or a malformed snapshot)
  // cannot produce a partial file.
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 253_402_300_799_999
  );
}

function validateSharedVoteFacts(
  votes: readonly SharedExportVoteFacts[],
): void {
  for (const [index, vote] of votes.entries()) {
    if (
      !Number.isSafeInteger(vote.alignmentKey) ||
      vote.alignmentKey !== index ||
      !validTimestamp(vote.createdAtMs) ||
      (index > 0 && vote.createdAtMs < votes[index - 1]!.createdAtMs)
    ) {
      throw new Error("Malformed export Vote order");
    }
    if (vote.comment === null) continue;
    const { body, displayName, createdAtMs } = vote.comment;
    if (
      typeof body !== "string" ||
      body.length < 1 ||
      body.length > COMMENT_CAPS.body ||
      body !== body.trim() ||
      /[\0\r]/u.test(body) ||
      (displayName !== null &&
        (typeof displayName !== "string" ||
          displayName.length < 1 ||
          displayName.length > COMMENT_CAPS.displayName ||
          displayName !== displayName.trim() ||
          /[\0\r\n]/u.test(displayName))) ||
      !validTimestamp(createdAtMs) ||
      createdAtMs !== vote.createdAtMs
    ) {
      throw new Error("Malformed export Comment");
    }
  }
}

function validCell(cell: PollTypeExportCell): boolean {
  return (
    (typeof cell === "string" && !cell.includes("\0")) ||
    (typeof cell === "number" && Number.isSafeInteger(cell))
  );
}

function validateTable(
  table: PollTypeExportTable,
  label: string,
  allowEmptyRows: boolean,
): void {
  if (
    table.columns.length === 0 ||
    table.columns.some(
      (column) =>
        typeof column !== "string" ||
        column.length === 0 ||
        column !== column.trim() ||
        /[\0\r\n]/u.test(column),
    ) ||
    new Set(table.columns).size !== table.columns.length ||
    (!allowEmptyRows && table.rows.length === 0) ||
    table.rows.some(
      (row) =>
        row.length !== table.columns.length || row.some((cell) => !validCell(cell)),
    )
  ) {
    throw new Error(`Malformed ${label} export table`);
  }
}

function validateProjection(
  sharedVotes: readonly SharedExportVoteFacts[],
  projection: PollTypeExportProjection,
): void {
  if (
    !Number.isSafeInteger(projection.voterCount) ||
    projection.voterCount < 0 ||
    !Number.isSafeInteger(projection.selectionCount) ||
    projection.selectionCount < 0 ||
    projection.voterCount !== sharedVotes.length ||
    projection.votes.rows.length !== sharedVotes.length ||
    projection.votes.rows.some(
      (row, index) => row.alignmentKey !== sharedVotes[index]!.alignmentKey,
    )
  ) {
    throw new Error("Malformed Poll Type export totals");
  }
  validateTable(
    {
      columns: projection.votes.columns,
      rows: projection.votes.rows.map(({ cells }) => cells),
    },
    "Poll Type Vote",
    true,
  );
  validateTable(projection.tally, "Poll Type Tally", false);
}

function materializeCanonicalExport(
  canonicalReference: string,
  sharedVotes: readonly SharedExportVoteFacts[],
  projection: PollTypeExportProjection,
): OwnerExport {
  validateSharedVoteFacts(sharedVotes);
  validateProjection(sharedVotes, projection);

  const voteColumns = [
    "TIMESTAMP",
    "DISPLAY NAME",
    "COMMENT",
    ...projection.votes.columns,
  ];
  if (new Set(voteColumns).size !== voteColumns.length) {
    throw new Error("Conflicting Poll Type export columns");
  }

  return {
    canonicalReference,
    dataset: {
      votes: {
        columns: voteColumns,
        rows: sharedVotes.map((vote, index) => [
          new Date(vote.createdAtMs).toISOString(),
          vote.comment?.displayName ?? "",
          vote.comment?.body ?? "",
          ...(projection.votes.rows[index]?.cells ?? []),
        ]),
      },
      tally: projection.tally,
      summary: {
        columns: ["METRIC", "VALUE"],
        rows: [
          ["VOTERS", projection.voterCount],
          ["SELECTIONS", projection.selectionCount],
        ],
      },
    },
  };
}

function matchingDriver<T extends { readonly type: PollType }>(
  pollType: PollType,
  drivers: readonly T[],
): T {
  const matchingDrivers = drivers.filter(({ type }) => type === pollType);
  if (matchingDrivers.length !== 1) {
    throw new Error(
      matchingDrivers.length === 0
        ? "Unsupported Poll Type export projection"
        : "Duplicate Poll Type export projection",
    );
  }
  return matchingDrivers[0]!;
}

export async function queryOwnerExport(
  ports: ExportPorts,
  pollId: PollId,
  viewer: ViewerContext,
  drivers: readonly ExportDriver[],
): Promise<OwnerExport | null> {
  // Anonymous viewers cannot trigger even the safe owner-envelope read.
  if (viewer.userId === null) return null;
  const envelope = await ports.findOwnerEnvelope(pollId, viewer.userId);
  if (!envelope) return null;
  if (envelope.pollId !== pollId) {
    throw new Error("Mismatched export owner envelope");
  }

  const driver = matchingDriver(envelope.pollType, drivers);
  const driven = await driver.project(envelope.pollId);
  if (!driven) throw new Error("Export projection unavailable");
  return materializeCanonicalExport(
    envelope.canonicalReference,
    driven.sharedVotes,
    driven.projection,
  );
}

export async function queryBoundedOwnerExport(
  ports: ExportPorts,
  pollId: PollId,
  viewer: ViewerContext,
  drivers: readonly BoundedExportDriver[],
): Promise<BoundedOwnerExport | null> {
  if (viewer.userId === null) return null;
  const envelope = await ports.findOwnerEnvelope(pollId, viewer.userId);
  if (!envelope) return null;
  if (envelope.pollId !== pollId) {
    throw new Error("Mismatched export owner envelope");
  }

  const driver = matchingDriver(envelope.pollType, drivers);
  const driven = await driver.project(envelope.pollId);
  if (!driven) throw new Error("Export projection unavailable");
  if (driven.status === "oversize") return driven;
  return {
    status: "ready",
    export: materializeCanonicalExport(
      envelope.canonicalReference,
      driven.sharedVotes,
      driven.projection,
    ),
  };
}

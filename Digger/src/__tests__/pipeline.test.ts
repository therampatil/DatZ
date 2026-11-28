import { test } from "node:test";
import assert from "node:assert/strict";

// Keep the pipeline fully offline: no real client is created, and the test
// injects a fake Supabase client plus fake scrapers.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.SUPABASE_ANON_KEY = "";
process.env.DATZ_FIXTURE_MODE = "true";

type Row = Record<string, any>;

interface Filter {
  kind: "eq" | "in";
  column: string;
  value: unknown;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.kind === "eq") return row[filter.column] === filter.value;
    const values = filter.value as unknown[];
    return values.includes(row[filter.column]);
  });
}

class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: any;
  private filters: Filter[] = [];
  private singleMode = false;

  constructor(private readonly client: FakeSupabase, private readonly table: string) {}

  select(_columns?: string): this {
    return this;
  }

  insert(payload: Row): this {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row): this {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  upsert(payload: Row[], _options?: unknown): this {
    this.op = "upsert";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]): this {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  single(): this {
    this.singleMode = true;
    return this;
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): { data: any; error: any } {
    if (this.table === "properties") {
      if (this.op === "upsert") {
        const batch = this.payload as Row[];
        this.client.upsertedBatches.push(batch);
        for (const row of batch) {
          this.client.properties.set(String(row.external_id), row);
        }
        return { data: null, error: null };
      }
      const rows = [...this.client.properties.values()].filter((row) => matches(row, this.filters));
      return { data: rows.map((row) => ({ external_id: row.external_id })), error: null };
    }

    if (this.table === "data_sources") {
      return { data: this.client.sources, error: null };
    }

    if (this.table === "scraper_runs") {
      if (this.op === "insert") {
        const row = { id: `run-${this.client.runs.length + 1}`, ...(this.payload as Row) };
        this.client.runs.push(row);
        return this.singleMode ? { data: { id: row.id }, error: null } : { data: [row], error: null };
      }
      if (this.op === "update") {
        const target = this.client.runs.find((row) => matches(row, this.filters));
        if (!target) return { data: null, error: { message: "run not found" } };
        Object.assign(target, this.payload);
        return { data: null, error: null };
      }
      return { data: this.client.runs, error: null };
    }

    return { data: null, error: null };
  }
}

class FakeSupabase {
  readonly properties = new Map<string, Row>();
  readonly runs: Row[] = [];
  readonly upsertedBatches: Row[][] = [];
  readonly sources: Row[] = [
    { id: "source-1", name: "Unit Feed" },
    { id: "source-2", name: "MahaRERA Official Registry" },
  ];

  constructor(existing: Row[] = []) {
    for (const row of existing) this.properties.set(String(row.external_id), row);
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
}

function rawListing(externalId: string, projectName: string, price = 10_000_000): Row {
  return {
    externalId,
    projectName,
    builderName: "Test Builder",
    city: "Pune",
    locality: "Baner",
    location: "Baner, Pune",
    pinCode: "411045",
    carpetAreaSqft: 1000,
    askingPrice: price,
    pricePerSqft: Math.round(price / 1000),
    builtUpAreaSqft: 1180,
    superBuiltUpAreaSqft: 1350,
    configuration: "2 BHK",
    propertyType: "Apartment",
    propertySubType: "Resale",
    floorNumber: 6,
    totalFloors: 14,
    facing: "East",
    parkingCount: 1,
    furnishingStatus: "Semi-Furnished",
    constructionStage: "Ready To Move",
    possessionDate: "2026-12-31",
    listedBy: "owner",
    sourceUrl: `https://example.test/${externalId}`,
    latitude: 18.559,
    longitude: 73.7868,
    listingSource: "Unit Feed",
    reraStatus: "Listed",
    status: "Active",
    listingTimestamp: "2026-01-01T00:00:00.000Z",
    daysOnMarket: 10,
    rawPayload: { externalId },
  };
}

test("pipeline upserts, deduplicates and reports added vs updated rows", async () => {
  const { PipelineOrchestrator } = await import("../scrapers/pipelineOrchestrator.js");
  const fake = new FakeSupabase([
    { external_id: "A-1", dataset_id: "dataset-1", project_name: "Old name" },
  ]);

  const activity: number[] = [];
  const result = await PipelineOrchestrator.runFullPipeline({
    client: fake,
    datasets: [{ slug: "pune-real-estate-data", id: "dataset-1" }],
    tasks: [
      {
        datasetSlug: "pune-real-estate-data",
        sourceName: "Unit Feed",
        scrape: async () => [
          rawListing("A-1", "Existing Project"),
          rawListing("A-2", "New Project", 12_000_000),
          // Same external id again: the pipeline must keep one row only.
          rawListing("A-2", "New Project duplicate", 12_000_000),
        ],
        toInput: (row) => row,
      },
    ],
    buildSnapshots: async () => ({ processedDatasets: 1, totalSnapshotsCreated: 3 }),
    recordScrapeActivity: (records) => activity.push(records),
  });

  assert.equal(result.status, "completed");
  assert.equal(result.totalIngested, 2, "deduplicated rows should be ingested once");
  assert.equal(result.datasetsUpdated, 1);
  assert.equal(result.snapshotsCreated, 3);
  assert.deepEqual(result.sources, [
    {
      source: "Unit Feed",
      status: "completed",
      rows: 2,
      added: 1,
      updated: 1,
      rejected: 0,
      duplicates: 1,
    },
  ]);
  assert.deepEqual(activity, [2]);

  assert.equal(fake.properties.size, 2);
  assert.equal(fake.upsertedBatches.flat().length, 2);
  assert.equal(fake.runs.length, 1);
  assert.equal(fake.runs[0].status, "completed");
  assert.equal(fake.runs[0].records_added, 1);
  assert.equal(fake.runs[0].records_updated, 1);
  assert.equal(fake.runs[0].source_id, "source-1");
  assert.ok(fake.runs[0].completed_at);

  const stored = [...fake.properties.values()].find((row) => row.external_id === "A-2");
  assert.equal(stored?.dataset_id, "dataset-1");
  assert.equal(stored?.project_name, "New Project");
  assert.equal(stored?.is_verified, false, "non-official feeds are never auto-verified");
  assert.ok(Number(stored?.data_quality_score) >= 85);
  assert.match(String(stored?.content_hash), /^[a-f0-9]{64}$/);
});

test("pipeline marks the scraper run failed and surfaces the source error", async () => {
  const { PipelineOrchestrator } = await import("../scrapers/pipelineOrchestrator.js");
  const fake = new FakeSupabase();

  await assert.rejects(
    PipelineOrchestrator.runFullPipeline({
      client: fake,
      datasets: [{ slug: "pune-real-estate-data", id: "dataset-1" }],
      tasks: [
        {
          datasetSlug: "pune-real-estate-data",
          sourceName: "Unit Feed",
          scrape: async () => {
            throw new Error("upstream returned HTTP 503");
          },
          toInput: (row) => row,
        },
      ],
      buildSnapshots: async () => ({ processedDatasets: 0, totalSnapshotsCreated: 0 }),
      recordScrapeActivity: () => undefined,
    }),
    /upstream returned HTTP 503/
  );

  assert.equal(fake.runs.length, 1);
  assert.equal(fake.runs[0].status, "failed");
  assert.match(String(fake.runs[0].error_message), /HTTP 503/);
  assert.ok(fake.runs[0].completed_at);
  assert.equal(fake.upsertedBatches.length, 0);
});

import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const researchTurns = sqliteTable(
  "research_turns",
  {
    id: text("id").primaryKey(),
    sid: text("sid").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull(),
    expires: integer("expires").notNull(),
  },
  (t) => [index("research_turns_expires_idx").on(t.expires)],
);
export const datasets = sqliteTable("datasets", {
  id: text("id").primaryKey(),
  domain_version: integer("domain_version").notNull(),
  manifest_sha256: text("manifest_sha256").notNull(),
  row_count: integer("row_count").notNull(),
  salary_count: integer("salary_count").notNull(),
  collected_at: text("collected_at").notNull(),
  date_from: text("date_from").notNull(),
  date_to: text("date_to").notNull(),
  taxonomy_json: text("taxonomy_json").notNull(),
  manifest_json: text("manifest_json").notNull(),
});
export const activeDataset = sqliteTable(
  "active_dataset",
  {
    singleton: integer("singleton").primaryKey(),
    dataset_id: text("dataset_id")
      .notNull()
      .references(() => datasets.id),
  },
  (t) => [check("active_dataset_singleton", sql`${t.singleton}=1`)],
);
export const jobs = sqliteTable(
  "jobs",
  {
    dataset_id: text("dataset_id")
      .notNull()
      .references(() => datasets.id),
    id: text("id").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    country: text("country").notNull(),
    location: text("location").notNull(),
    occupation: text("occupation").notNull(),
    category: text("category").notNull(),
    industry: text("industry").notNull(),
    source: text("source").notNull(),
    education: text("education").notNull(),
    education_level: text("education_level").notNull(),
    experience: text("experience").notNull(),
    exp_group: text("exp_group").notNull(),
    employment_type: text("employment_type").notNull(),
    hiring_channel: text("hiring_channel").notNull(),
    scale: text("scale").notNull(),
    property: text("property").notNull(),
    search_text: text("search_text").notNull(),
    raw_json: text("raw_json").notNull(),
    ordinal: integer("ordinal").notNull(),
    salary_valid: integer("salary_valid").notNull(),
    city_known: integer("city_known").notNull(),
    mainland: integer("mainland").notNull(),
    major_required: integer("major_required").notNull(),
    entry_only: integer("entry_only").notNull(),
    intern: integer("intern").notNull(),
    graduate: integer("graduate").notNull(),
    experience_unlimited: integer("experience_unlimited").notNull(),
    salary_min: real("salary_min"),
    salary_max: real("salary_max"),
    salary_midpoint: real("salary_midpoint"),
    published_at: text("published_at"),
    updated_at: text("updated_at"),
    expires_at: text("expires_at"),
    experience_min: integer("experience_min"),
  },
  (t) => [
    primaryKey({ columns: [t.dataset_id, t.id] }),
    uniqueIndex("jobs_ordinal_idx").on(t.dataset_id, t.ordinal),
    index("jobs_occupation_idx").on(t.dataset_id, t.occupation),
    index("jobs_salary_idx").on(
      t.dataset_id,
      t.salary_valid,
      t.salary_midpoint,
    ),
    index("jobs_dates_idx").on(t.dataset_id, t.updated_at),
    index("jobs_summary_idx").on(
      t.dataset_id,
      t.mainland,
      t.city_known,
      t.salary_valid,
      t.salary_midpoint,
      t.company,
      t.education_level,
      t.exp_group,
      t.id,
    ),
  ],
);
export const jobCities = sqliteTable(
  "job_cities",
  {
    dataset_id: text("dataset_id").notNull(),
    job_id: text("job_id").notNull(),
    city: text("city").notNull(),
    city_group: text("city_group").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dataset_id, t.job_id, t.city] }),
    index("job_cities_lookup_idx").on(t.dataset_id, t.city, t.job_id),
    index("job_cities_group_idx").on(t.dataset_id, t.city_group, t.job_id),
  ],
);
export const jobSkills = sqliteTable(
  "job_skills",
  {
    dataset_id: text("dataset_id").notNull(),
    job_id: text("job_id").notNull(),
    skill: text("skill").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dataset_id, t.job_id, t.skill] }),
    index("job_skills_lookup_idx").on(t.dataset_id, t.skill, t.job_id),
  ],
);
export const jobRelatedMajors = sqliteTable(
  "job_related_majors",
  {
    dataset_id: text("dataset_id").notNull(),
    job_id: text("job_id").notNull(),
    major: text("major").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dataset_id, t.job_id, t.major] }),
    index("job_related_majors_lookup_idx").on(t.dataset_id, t.major, t.job_id),
  ],
);

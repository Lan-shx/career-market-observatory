CREATE TABLE `active_dataset` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "active_dataset_singleton" CHECK("active_dataset"."singleton"=1)
);
--> statement-breakpoint
CREATE TABLE `datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`domain_version` integer NOT NULL,
	`manifest_sha256` text NOT NULL,
	`row_count` integer NOT NULL,
	`salary_count` integer NOT NULL,
	`collected_at` text NOT NULL,
	`date_from` text NOT NULL,
	`date_to` text NOT NULL,
	`taxonomy_json` text NOT NULL,
	`manifest_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_cities` (
	`dataset_id` text NOT NULL,
	`job_id` text NOT NULL,
	`city` text NOT NULL,
	`city_group` text NOT NULL,
	PRIMARY KEY(`dataset_id`, `job_id`, `city`)
);
--> statement-breakpoint
CREATE INDEX `job_cities_lookup_idx` ON `job_cities` (`dataset_id`,`city`,`job_id`);--> statement-breakpoint
CREATE INDEX `job_cities_group_idx` ON `job_cities` (`dataset_id`,`city_group`,`job_id`);--> statement-breakpoint
CREATE TABLE `job_related_majors` (
	`dataset_id` text NOT NULL,
	`job_id` text NOT NULL,
	`major` text NOT NULL,
	PRIMARY KEY(`dataset_id`, `job_id`, `major`)
);
--> statement-breakpoint
CREATE INDEX `job_related_majors_lookup_idx` ON `job_related_majors` (`dataset_id`,`major`,`job_id`);--> statement-breakpoint
CREATE TABLE `job_skills` (
	`dataset_id` text NOT NULL,
	`job_id` text NOT NULL,
	`skill` text NOT NULL,
	PRIMARY KEY(`dataset_id`, `job_id`, `skill`)
);
--> statement-breakpoint
CREATE INDEX `job_skills_lookup_idx` ON `job_skills` (`dataset_id`,`skill`,`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`dataset_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`country` text NOT NULL,
	`location` text NOT NULL,
	`occupation` text NOT NULL,
	`category` text NOT NULL,
	`industry` text NOT NULL,
	`source` text NOT NULL,
	`education` text NOT NULL,
	`education_level` text NOT NULL,
	`experience` text NOT NULL,
	`exp_group` text NOT NULL,
	`employment_type` text NOT NULL,
	`hiring_channel` text NOT NULL,
	`scale` text NOT NULL,
	`property` text NOT NULL,
	`search_text` text NOT NULL,
	`raw_json` text NOT NULL,
	`ordinal` integer NOT NULL,
	`salary_valid` integer NOT NULL,
	`city_known` integer NOT NULL,
	`mainland` integer NOT NULL,
	`major_required` integer NOT NULL,
	`entry_only` integer NOT NULL,
	`intern` integer NOT NULL,
	`graduate` integer NOT NULL,
	`experience_unlimited` integer NOT NULL,
	`salary_min` real,
	`salary_max` real,
	`salary_midpoint` real,
	`published_at` text,
	`updated_at` text,
	`expires_at` text,
	`experience_min` integer,
	PRIMARY KEY(`dataset_id`, `id`),
	FOREIGN KEY (`dataset_id`) REFERENCES `datasets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_ordinal_idx` ON `jobs` (`dataset_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `jobs_occupation_idx` ON `jobs` (`dataset_id`,`occupation`);--> statement-breakpoint
CREATE INDEX `jobs_salary_idx` ON `jobs` (`dataset_id`,`salary_valid`,`salary_midpoint`);--> statement-breakpoint
CREATE INDEX `jobs_dates_idx` ON `jobs` (`dataset_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `research_turns_expires_idx` ON `research_turns` (`expires`);
--> statement-breakpoint
-- Deliberately narrow model-visible schema. Only the validated ID selection
-- grammar is accepted; the Worker always adds dataset and inherited scope.
CREATE VIEW job_search AS SELECT j.dataset_id,j.id,j.occupation,j.title,j.company,j.industry,j.source,
 j.education_level,j.exp_group,j.employment_type,j.hiring_channel,j.salary_min,j.salary_max,j.salary_midpoint,
 j.published_at,j.updated_at,c.city,c.city_group
 FROM jobs j LEFT JOIN job_cities c ON c.dataset_id=j.dataset_id AND c.job_id=j.id;

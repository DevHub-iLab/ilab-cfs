CREATE TABLE `cfp` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`track` text NOT NULL,
	`description` text,
	`closes_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cfp_closesAt_idx` ON `cfp` (`closes_at`);
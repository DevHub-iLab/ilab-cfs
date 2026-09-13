CREATE TABLE `proposal` (
	`id` text PRIMARY KEY NOT NULL,
	`cfp_id` text NOT NULL,
	`speaker_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`abstract` text DEFAULT '' NOT NULL,
	`format` text DEFAULT 'talk' NOT NULL,
	`level` text DEFAULT 'intermediate' NOT NULL,
	`topics` text DEFAULT '[]' NOT NULL,
	`links` text DEFAULT '[]' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`submitted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`cfp_id`) REFERENCES `cfp`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`speaker_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposal_speakerId_idx` ON `proposal` (`speaker_id`);--> statement-breakpoint
CREATE INDEX `proposal_cfpId_status_idx` ON `proposal` (`cfp_id`,`status`);--> statement-breakpoint
CREATE TABLE `proposal_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`abstract` text NOT NULL,
	`format` text NOT NULL,
	`level` text NOT NULL,
	`topics` text NOT NULL,
	`links` text NOT NULL,
	`bio` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_revision_proposalId_revision_idx` ON `proposal_revision` (`proposal_id`,`revision`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_match_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`application_id` text NOT NULL,
	`member_id` text NOT NULL,
	`rule_score` real NOT NULL,
	`ai_likelihood` text,
	`ai_reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by_id` text,
	`decided_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "match_candidates_ai_likelihood_check" CHECK("__new_match_candidates"."ai_likelihood" IS NULL OR "__new_match_candidates"."ai_likelihood" IN ('high', 'medium', 'low')),
	CONSTRAINT "match_candidates_status_check" CHECK("__new_match_candidates"."status" IN ('pending', 'merged', 'rejected', 'hold', 'stale'))
);
--> statement-breakpoint
INSERT INTO `__new_match_candidates`("id", "tenant_id", "application_id", "member_id", "rule_score", "ai_likelihood", "ai_reason", "status", "decided_by_id", "decided_at", "created_at", "updated_at") SELECT "id", "tenant_id", "application_id", "member_id", "rule_score", "ai_likelihood", "ai_reason", "status", "decided_by_id", "decided_at", "created_at", "updated_at" FROM `match_candidates`;--> statement-breakpoint
DROP TABLE `match_candidates`;--> statement-breakpoint
ALTER TABLE `__new_match_candidates` RENAME TO `match_candidates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `match_candidates_application_member_unique` ON `match_candidates` (`application_id`,`member_id`);
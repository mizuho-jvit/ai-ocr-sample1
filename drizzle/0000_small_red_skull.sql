CREATE TABLE `app_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`application_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by_id` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "app_status_history_from_status_check" CHECK("app_status_history"."from_status" IS NULL OR "app_status_history"."from_status" IN ('received', 'under_review', 'approved', 'returned')),
	CONSTRAINT "app_status_history_to_status_check" CHECK("app_status_history"."to_status" IN ('received', 'under_review', 'approved', 'returned'))
);
--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`doc_type` text NOT NULL,
	`fields_json` text NOT NULL,
	`image_key` text,
	`app_status` text DEFAULT 'received' NOT NULL,
	`latest_check_run_id` text,
	`edited_count` integer DEFAULT 0 NOT NULL,
	`processing_sec` real NOT NULL,
	`member_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by_id` text NOT NULL,
	`updated_by_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`latest_check_run_id`) REFERENCES `check_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "applications_app_status_check" CHECK("applications"."app_status" IN ('received', 'under_review', 'approved', 'returned'))
);
--> statement-breakpoint
CREATE TABLE `check_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`application_id` text NOT NULL,
	`triage` text NOT NULL,
	`triage_reason` text NOT NULL,
	`consistency_json` text NOT NULL,
	`deficiencies_json` text NOT NULL,
	`letter_draft` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by_id` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "check_runs_triage_check" CHECK("check_runs"."triage" IN ('approval_candidate', 'needs_review', 'return_candidate'))
);
--> statement-breakpoint
CREATE TABLE `match_candidates` (
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
	CONSTRAINT "match_candidates_ai_likelihood_check" CHECK("match_candidates"."ai_likelihood" IS NULL OR "match_candidates"."ai_likelihood" IN ('high', 'medium', 'low')),
	CONSTRAINT "match_candidates_status_check" CHECK("match_candidates"."status" IN ('pending', 'merged', 'rejected', 'hold'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_candidates_application_member_unique` ON `match_candidates` (`application_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_number` text NOT NULL,
	`name` text NOT NULL,
	`name_kana` text,
	`name_normalized` text NOT NULL,
	`kana_normalized` text NOT NULL,
	`birth_date` text,
	`postal_code` text,
	`address` text,
	`phone` text NOT NULL,
	`email` text,
	`status` text NOT NULL,
	`is_seed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by_id` text,
	`updated_by_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "members_status_check" CHECK("members"."status" IN ('pending', 'active', 'suspended', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_tenant_member_number_unique` ON `members` (`tenant_id`,`member_number`);--> statement-breakpoint
CREATE INDEX `members_tenant_name_normalized_index` ON `members` (`tenant_id`,`name_normalized`);--> statement-breakpoint
CREATE INDEX `members_tenant_kana_normalized_index` ON `members` (`tenant_id`,`kana_normalized`);--> statement-breakpoint
CREATE INDEX `members_tenant_phone_index` ON `members` (`tenant_id`,`phone`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`staff_user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by_id` text,
	`updated_by_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_users_role_check" CHECK("staff_users"."role" IN ('admin', 'staff'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_users_tenant_email_unique` ON `staff_users` (`tenant_id`,`email`);--> statement-breakpoint
CREATE TABLE `status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`member_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_by_id` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "status_history_from_status_check" CHECK("status_history"."from_status" IS NULL OR "status_history"."from_status" IN ('pending', 'active', 'suspended', 'inactive')),
	CONSTRAINT "status_history_to_status_check" CHECK("status_history"."to_status" IN ('pending', 'active', 'suspended', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_code_unique` ON `tenants` (`code`);--> statement-breakpoint
CREATE TABLE `usage_counter` (
	`period` text PRIMARY KEY NOT NULL,
	`ocr_pages` integer DEFAULT 0 NOT NULL,
	`gemini_calls` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

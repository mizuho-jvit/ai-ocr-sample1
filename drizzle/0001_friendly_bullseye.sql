PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_members` (
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
	CONSTRAINT "members_status_check" CHECK("__new_members"."status" IN ('pending', 'active', 'suspended', 'inactive')),
	CONSTRAINT "members_phone_digits_check" CHECK("__new_members"."phone" != '' AND "__new_members"."phone" NOT GLOB '*[^0-9]*'),
	CONSTRAINT "members_birth_date_format_check" CHECK("__new_members"."birth_date" IS NULL OR "__new_members"."birth_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
INSERT INTO `__new_members`("id", "tenant_id", "member_number", "name", "name_kana", "name_normalized", "kana_normalized", "birth_date", "postal_code", "address", "phone", "email", "status", "is_seed", "created_at", "updated_at", "created_by_id", "updated_by_id") SELECT "id", "tenant_id", "member_number", "name", "name_kana", "name_normalized", "kana_normalized", "birth_date", "postal_code", "address", "phone", "email", "status", "is_seed", "created_at", "updated_at", "created_by_id", "updated_by_id" FROM `members`;--> statement-breakpoint
DROP TABLE `members`;--> statement-breakpoint
ALTER TABLE `__new_members` RENAME TO `members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `members_tenant_member_number_unique` ON `members` (`tenant_id`,`member_number`);--> statement-breakpoint
CREATE INDEX `members_tenant_name_normalized_index` ON `members` (`tenant_id`,`name_normalized`);--> statement-breakpoint
CREATE INDEX `members_tenant_kana_normalized_index` ON `members` (`tenant_id`,`kana_normalized`);--> statement-breakpoint
CREATE INDEX `members_tenant_phone_index` ON `members` (`tenant_id`,`phone`);
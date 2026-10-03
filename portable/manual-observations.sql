CREATE TABLE IF NOT EXISTS `market_snapshots` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_market_snapshots_fetched_at` ON `market_snapshots` (`fetched_at`);
CREATE TABLE IF NOT EXISTS `market_archive` (
	`key` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`interval` text NOT NULL,
	`adjustment` text NOT NULL,
	`source_timestamp` text NOT NULL,
	`payload` text NOT NULL,
	`first_fetched_at` text NOT NULL,
	`last_fetched_at` text NOT NULL,
	`revision_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_market_archive_lookup` ON `market_archive` (`symbol`,`kind`,`interval`,`adjustment`,`source_timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_market_archive_last_fetched_at` ON `market_archive` (`last_fetched_at`);
CREATE TABLE IF NOT EXISTS `watchlist` (
	`owner` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`verified_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_watchlist_owner_symbol` ON `watchlist` (`owner`,`symbol`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `watchlist_preferences` (
	`owner` text PRIMARY KEY NOT NULL,
	`selected_symbol` text
);

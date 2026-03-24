-- TowerIntel Vietnam — add per-user active flag for account activation/deactivation
-- Run this after 001_profiles.sql and 002_add_upload.sql

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Backfill safety for older rows
UPDATE public.profiles
SET active = true
WHERE active IS NULL;

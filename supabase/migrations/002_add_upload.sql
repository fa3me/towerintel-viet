-- TowerIntel Vietnam — Add approved_upload column to profiles
-- Run this in Supabase SQL Editor after 001_profiles.sql

-- Add the upload permission column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approved_upload boolean NOT NULL DEFAULT false;

-- The existing owner policies (profiles_owner_select_all, profiles_owner_update_all)
-- already cover SELECT and UPDATE on all columns — no new policy needed.

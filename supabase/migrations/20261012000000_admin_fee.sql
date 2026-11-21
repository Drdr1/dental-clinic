-- =====================================================================
-- Dental Clinic System — migration 0024: the management fee
-- Requires: 0001–0023
--
-- The clinic pays a management fee each month — a percentage of the
-- month's income, taken by whoever runs the place. It is entered by
-- hand like the rent, but it needs a line of its own in the profit
-- statement instead of disappearing into 'other'.
--
-- An enum value must be added before anything can use it, so the
-- percentage column goes in the next migration.
-- =====================================================================

alter type public.expense_category add value if not exists 'admin';

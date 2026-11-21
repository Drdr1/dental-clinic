-- =====================================================================
-- Dental Clinic System — migration 0022: a category of its own for
-- what the doctors take.
-- Requires: 0001–0021
--
-- Doctor payouts were being filed under 'salaries', which mixed them
-- with the receptionist's wage and made the monthly profit statement
-- impossible to read. They get their own line from here on.
--
-- An enum value has to be added in a transaction of its own before
-- anything can use it, so this migration does nothing else.
-- =====================================================================

alter type public.expense_category add value if not exists 'doctors';

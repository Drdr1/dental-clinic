-- =====================================================================
-- Dental Clinic System — migration 0026: let the owner edit the
-- management fee percentage.
-- Requires: 0025
--
-- Writes to clinics are granted column by column, so that the receipt
-- counter and other machinery stay out of reach. A new column is not
-- writable until it is named here — without this, saving the settings
-- form fails with "permission denied for table clinics".
-- =====================================================================

grant update (admin_percent) on public.clinics to authenticated;

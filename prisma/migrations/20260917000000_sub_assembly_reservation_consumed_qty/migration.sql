-- Running, never-shrinking total of how much of a SubAssemblyReservation
-- claim has already been FIFO-consumed into another node's batch — `qty`
-- stays the live outstanding claim (shrinks on consume, used by
-- availability/shortage checks); this tracks the claim's full lifetime
-- total so the payroll labor estimate can stay flat once a "Зі складу"
-- choice is made, even after the claimed stock actually gets used.
ALTER TABLE "sub_assembly_reservations" ADD COLUMN "consumedQty" DECIMAL(14,3) NOT NULL DEFAULT 0;

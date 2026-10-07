-- "3D-модель збірки" (2026-10-08): FileAsset.domain gains ASSEMBLY_3D_MODEL
-- for a self-contained interactive HTML export of an assembly's 3D model
-- (entityType "Assembly"). No table changes — additive enum value only.
ALTER TYPE "FileDomain" ADD VALUE 'ASSEMBLY_3D_MODEL';

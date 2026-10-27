import { apiClient } from './http';
import type { DecimalString } from './decimal';

/**
 * Typed wrappers for backend/src/modules/logistics/ (TransportUnitTypesController).
 * Field shapes copied verbatim from dto/transport-unit-type.dto.ts and
 * schema.prisma's TransportUnitType model.
 */

export interface TransportUnitType {
  id: string;
  companyId: string;
  name: string;
  maxWeightKg: DecimalString;
  maxVolumeM3: DecimalString | null;
  maxPackages: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateTransportUnitTypeInput {
  name: string;
  maxWeightKg: number;
  maxVolumeM3?: number;
  maxPackages?: number;
  active?: boolean;
}
export type UpdateTransportUnitTypeInput = Partial<CreateTransportUnitTypeInput>;

export function listTransportUnitTypes(): Promise<TransportUnitType[]> {
  return apiClient.get<TransportUnitType[]>('transport-unit-types');
}
export function createTransportUnitType(dto: CreateTransportUnitTypeInput): Promise<TransportUnitType> {
  return apiClient.post<TransportUnitType>('transport-unit-types', dto);
}
export function updateTransportUnitType(id: string, dto: UpdateTransportUnitTypeInput): Promise<TransportUnitType> {
  return apiClient.patch<TransportUnitType>(`transport-unit-types/${id}`, dto);
}
export function deleteTransportUnitType(id: string): Promise<TransportUnitType> {
  return apiClient.delete<TransportUnitType>(`transport-unit-types/${id}`);
}

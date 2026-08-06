-- DropForeignKey
ALTER TABLE "ai_usage_logs" DROP CONSTRAINT "fk_ai_usage_logs_company";

-- DropForeignKey
ALTER TABLE "assemblies" DROP CONSTRAINT "fk_assemblies_company";

-- DropForeignKey
ALTER TABLE "assemblies" DROP CONSTRAINT "fk_assemblies_defaultSupplier";

-- DropForeignKey
ALTER TABLE "assembly_components" DROP CONSTRAINT "fk_assembly_components_assembly";

-- DropForeignKey
ALTER TABLE "assembly_components" DROP CONSTRAINT "fk_assembly_components_company";

-- DropForeignKey
ALTER TABLE "assembly_components" DROP CONSTRAINT "fk_assembly_components_product";

-- DropForeignKey
ALTER TABLE "assembly_components" DROP CONSTRAINT "fk_assembly_components_subAssembly";

-- DropForeignKey
ALTER TABLE "assembly_components" DROP CONSTRAINT "fk_assembly_components_warehouse";

-- DropForeignKey
ALTER TABLE "assembly_version_components" DROP CONSTRAINT "fk_assembly_version_components_assemblyVersion";

-- DropForeignKey
ALTER TABLE "assembly_version_components" DROP CONSTRAINT "fk_assembly_version_components_company";

-- DropForeignKey
ALTER TABLE "assembly_versions" DROP CONSTRAINT "fk_assembly_versions_assembly";

-- DropForeignKey
ALTER TABLE "assembly_versions" DROP CONSTRAINT "fk_assembly_versions_company";

-- DropForeignKey
ALTER TABLE "company_ai_settings" DROP CONSTRAINT "fk_company_ai_settings_company";

-- DropForeignKey
ALTER TABLE "company_branding" DROP CONSTRAINT "fk_company_branding_company";

-- DropForeignKey
ALTER TABLE "company_feature_flag_overrides" DROP CONSTRAINT "fk_company_feature_flag_overrides_company";

-- DropForeignKey
ALTER TABLE "company_feature_flag_overrides" DROP CONSTRAINT "fk_company_feature_flag_overrides_featureFlag";

-- DropForeignKey
ALTER TABLE "company_memberships" DROP CONSTRAINT "fk_company_memberships_company";

-- DropForeignKey
ALTER TABLE "company_memberships" DROP CONSTRAINT "fk_company_memberships_role";

-- DropForeignKey
ALTER TABLE "company_memberships" DROP CONSTRAINT "fk_company_memberships_user";

-- DropForeignKey
ALTER TABLE "company_settings" DROP CONSTRAINT "fk_company_settings_company";

-- DropForeignKey
ALTER TABLE "company_subscriptions" DROP CONSTRAINT "fk_company_subscriptions_company";

-- DropForeignKey
ALTER TABLE "company_subscriptions" DROP CONSTRAINT "fk_company_subscriptions_plan";

-- DropForeignKey
ALTER TABLE "company_units" DROP CONSTRAINT "fk_company_units_company";

-- DropForeignKey
ALTER TABLE "customer_order_items" DROP CONSTRAINT "fk_customer_order_items_assembly";

-- DropForeignKey
ALTER TABLE "customer_order_items" DROP CONSTRAINT "fk_customer_order_items_company";

-- DropForeignKey
ALTER TABLE "customer_order_items" DROP CONSTRAINT "fk_customer_order_items_customerOrder";

-- DropForeignKey
ALTER TABLE "customer_order_items" DROP CONSTRAINT "fk_customer_order_items_productionOrder";

-- DropForeignKey
ALTER TABLE "customer_orders" DROP CONSTRAINT "fk_customer_orders_company";

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "fk_employees_company";

-- DropForeignKey
ALTER TABLE "file_assets" DROP CONSTRAINT "fk_file_assets_company";

-- DropForeignKey
ALTER TABLE "finished_goods" DROP CONSTRAINT "fk_finished_goods_assembly";

-- DropForeignKey
ALTER TABLE "finished_goods" DROP CONSTRAINT "fk_finished_goods_company";

-- DropForeignKey
ALTER TABLE "finished_goods" DROP CONSTRAINT "fk_finished_goods_customerOrder";

-- DropForeignKey
ALTER TABLE "finished_goods" DROP CONSTRAINT "fk_finished_goods_productionOrder";

-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "fk_inventory_items_company";

-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "fk_inventory_items_product";

-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "fk_inventory_items_session";

-- DropForeignKey
ALTER TABLE "inventory_sessions" DROP CONSTRAINT "fk_inventory_sessions_company";

-- DropForeignKey
ALTER TABLE "legacy_migration_runs" DROP CONSTRAINT "fk_legacy_migration_runs_company";

-- DropForeignKey
ALTER TABLE "payroll_entries" DROP CONSTRAINT "fk_payroll_entries_company";

-- DropForeignKey
ALTER TABLE "payroll_entries" DROP CONSTRAINT "fk_payroll_entries_employee";

-- DropForeignKey
ALTER TABLE "payroll_entries" DROP CONSTRAINT "fk_payroll_entries_productionOrder";

-- DropForeignKey
ALTER TABLE "pending_ai_actions" DROP CONSTRAINT "fk_pending_ai_actions_company";

-- DropForeignKey
ALTER TABLE "production_order_pick_list_items" DROP CONSTRAINT "fk_production_order_pick_list_items_company";

-- DropForeignKey
ALTER TABLE "production_order_pick_list_items" DROP CONSTRAINT "fk_production_order_pick_list_items_productionOrder";

-- DropForeignKey
ALTER TABLE "production_order_stage_events" DROP CONSTRAINT "fk_production_order_stage_events_company";

-- DropForeignKey
ALTER TABLE "production_order_stage_events" DROP CONSTRAINT "fk_production_order_stage_events_productionOrder";

-- DropForeignKey
ALTER TABLE "production_order_workers" DROP CONSTRAINT "fk_production_order_workers_company";

-- DropForeignKey
ALTER TABLE "production_order_workers" DROP CONSTRAINT "fk_production_order_workers_employee";

-- DropForeignKey
ALTER TABLE "production_order_workers" DROP CONSTRAINT "fk_production_order_workers_productionOrder";

-- DropForeignKey
ALTER TABLE "production_orders" DROP CONSTRAINT "fk_production_orders_assembly";

-- DropForeignKey
ALTER TABLE "production_orders" DROP CONSTRAINT "fk_production_orders_assemblyVersion";

-- DropForeignKey
ALTER TABLE "production_orders" DROP CONSTRAINT "fk_production_orders_company";

-- DropForeignKey
ALTER TABLE "production_stages" DROP CONSTRAINT "fk_production_stages_company";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "fk_products_company";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "fk_products_defaultSupplier";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "fk_products_unit";

-- DropForeignKey
ALTER TABLE "purchase_order_items" DROP CONSTRAINT "fk_purchase_order_items_company";

-- DropForeignKey
ALTER TABLE "purchase_order_items" DROP CONSTRAINT "fk_purchase_order_items_product";

-- DropForeignKey
ALTER TABLE "purchase_order_items" DROP CONSTRAINT "fk_purchase_order_items_purchaseOrder";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "fk_purchase_orders_company";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "fk_purchase_orders_sourceCustomerOrder";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "fk_purchase_orders_supplier";

-- DropForeignKey
ALTER TABLE "qc_check_results" DROP CONSTRAINT "fk_qc_check_results_company";

-- DropForeignKey
ALTER TABLE "qc_check_results" DROP CONSTRAINT "fk_qc_check_results_qcCheck";

-- DropForeignKey
ALTER TABLE "qc_checklist_items" DROP CONSTRAINT "fk_qc_checklist_items_company";

-- DropForeignKey
ALTER TABLE "qc_checks" DROP CONSTRAINT "fk_qc_checks_company";

-- DropForeignKey
ALTER TABLE "qc_checks" DROP CONSTRAINT "fk_qc_checks_finishedGood";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "fk_refresh_tokens_user";

-- DropForeignKey
ALTER TABLE "role_permissions" DROP CONSTRAINT "fk_role_permissions_permission";

-- DropForeignKey
ALTER TABLE "role_permissions" DROP CONSTRAINT "fk_role_permissions_role";

-- DropForeignKey
ALTER TABLE "roles" DROP CONSTRAINT "fk_roles_company";

-- DropForeignKey
ALTER TABLE "shipment_items" DROP CONSTRAINT "fk_shipment_items_company";

-- DropForeignKey
ALTER TABLE "shipment_items" DROP CONSTRAINT "fk_shipment_items_finishedGood";

-- DropForeignKey
ALTER TABLE "shipment_items" DROP CONSTRAINT "fk_shipment_items_shipment";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "fk_shipments_company";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "fk_shipments_customerOrder";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "fk_stock_movements_company";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "fk_stock_movements_product";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "fk_stock_movements_warehouse";

-- DropForeignKey
ALTER TABLE "suppliers" DROP CONSTRAINT "fk_suppliers_company";

-- DropForeignKey
ALTER TABLE "warehouse_stock" DROP CONSTRAINT "fk_warehouse_stock_company";

-- DropForeignKey
ALTER TABLE "warehouse_stock" DROP CONSTRAINT "fk_warehouse_stock_product";

-- DropForeignKey
ALTER TABLE "warehouse_stock" DROP CONSTRAINT "fk_warehouse_stock_warehouse";

-- DropForeignKey
ALTER TABLE "warehouses" DROP CONSTRAINT "fk_warehouses_company";

-- AlterTable
ALTER TABLE "ai_usage_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "assemblies" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "assembly_components" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "assembly_version_components" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "assembly_versions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "audit_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "companies" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "company_feature_flag_overrides" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "company_memberships" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "company_units" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "customer_order_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "customer_orders" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "feature_flags" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "file_assets" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "finished_goods" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "inventory_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "inventory_sessions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "legacy_migration_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payroll_entries" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pending_ai_actions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "permissions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "plans" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "production_order_pick_list_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "production_order_stage_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "production_order_workers" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "production_orders" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "production_stages" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "purchase_order_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "purchase_orders" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "qc_check_results" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "qc_checklist_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "qc_checks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shipment_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shipments" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stock_movements" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "super_admin_audit_log" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "super_admins" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "suppliers" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "warehouse_stock" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "warehouses" ALTER COLUMN "id" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_memberships" ADD CONSTRAINT "company_memberships_companyId_roleId_fkey" FOREIGN KEY ("companyId", "roleId") REFERENCES "roles"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_feature_flag_overrides" ADD CONSTRAINT "company_feature_flag_overrides_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_feature_flag_overrides" ADD CONSTRAINT "company_feature_flag_overrides_featureFlagId_fkey" FOREIGN KEY ("featureFlagId") REFERENCES "feature_flags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_unitId_fkey" FOREIGN KEY ("companyId", "unitId") REFERENCES "company_units"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_units" ADD CONSTRAINT "company_units_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_stock" ADD CONSTRAINT "warehouse_stock_companyId_warehouseId_fkey" FOREIGN KEY ("companyId", "warehouseId") REFERENCES "warehouses"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "inventory_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_companyId_inventorySessionId_fkey" FOREIGN KEY ("companyId", "inventorySessionId") REFERENCES "inventory_sessions"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_companyId_productId_fkey" FOREIGN KEY ("companyId", "productId") REFERENCES "products"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_companyId_assemblyId_fkey" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_subAssemblyId_fkey" FOREIGN KEY ("subAssemblyId") REFERENCES "assemblies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_versions" ADD CONSTRAINT "assembly_versions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_versions" ADD CONSTRAINT "assembly_versions_companyId_assemblyId_fkey" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_version_components" ADD CONSTRAINT "assembly_version_components_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_version_components" ADD CONSTRAINT "assembly_version_components_companyId_assemblyVersionId_fkey" FOREIGN KEY ("companyId", "assemblyVersionId") REFERENCES "assembly_versions"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_companyId_assemblyId_fkey" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_assemblyVersionId_fkey" FOREIGN KEY ("assemblyVersionId") REFERENCES "assembly_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_pick_list_items" ADD CONSTRAINT "production_order_pick_list_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_pick_list_items" ADD CONSTRAINT "production_order_pick_list_items_companyId_productionOrder_fkey" FOREIGN KEY ("companyId", "productionOrderId") REFERENCES "production_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_stage_events" ADD CONSTRAINT "production_order_stage_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_stage_events" ADD CONSTRAINT "production_order_stage_events_companyId_productionOrderId_fkey" FOREIGN KEY ("companyId", "productionOrderId") REFERENCES "production_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_workers" ADD CONSTRAINT "production_order_workers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_workers" ADD CONSTRAINT "production_order_workers_companyId_productionOrderId_fkey" FOREIGN KEY ("companyId", "productionOrderId") REFERENCES "production_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_workers" ADD CONSTRAINT "production_order_workers_companyId_employeeId_fkey" FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods" ADD CONSTRAINT "finished_goods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods" ADD CONSTRAINT "finished_goods_companyId_assemblyId_fkey" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods" ADD CONSTRAINT "finished_goods_companyId_productionOrderId_fkey" FOREIGN KEY ("companyId", "productionOrderId") REFERENCES "production_orders"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods" ADD CONSTRAINT "finished_goods_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_checklist_items" ADD CONSTRAINT "qc_checklist_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_checks" ADD CONSTRAINT "qc_checks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_checks" ADD CONSTRAINT "qc_checks_companyId_finishedGoodId_fkey" FOREIGN KEY ("companyId", "finishedGoodId") REFERENCES "finished_goods"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_check_results" ADD CONSTRAINT "qc_check_results_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_check_results" ADD CONSTRAINT "qc_check_results_companyId_qcCheckId_fkey" FOREIGN KEY ("companyId", "qcCheckId") REFERENCES "qc_checks"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_items" ADD CONSTRAINT "customer_order_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_items" ADD CONSTRAINT "customer_order_items_companyId_customerOrderId_fkey" FOREIGN KEY ("companyId", "customerOrderId") REFERENCES "customer_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_items" ADD CONSTRAINT "customer_order_items_companyId_assemblyId_fkey" FOREIGN KEY ("companyId", "assemblyId") REFERENCES "assemblies"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_items" ADD CONSTRAINT "customer_order_items_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_companyId_shipmentId_fkey" FOREIGN KEY ("companyId", "shipmentId") REFERENCES "shipments"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_companyId_finishedGoodId_fkey" FOREIGN KEY ("companyId", "finishedGoodId") REFERENCES "finished_goods"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sourceCustomerOrderId_fkey" FOREIGN KEY ("sourceCustomerOrderId") REFERENCES "customer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_companyId_purchaseOrderId_fkey" FOREIGN KEY ("companyId", "purchaseOrderId") REFERENCES "purchase_orders"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_companyId_employeeId_fkey" FOREIGN KEY ("companyId", "employeeId") REFERENCES "employees"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_branding" ADD CONSTRAINT "company_branding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_ai_settings" ADD CONSTRAINT "company_ai_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_ai_actions" ADD CONSTRAINT "pending_ai_actions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy_migration_runs" ADD CONSTRAINT "legacy_migration_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_ai_usage_logs_companyId_createdAt" RENAME TO "ai_usage_logs_companyId_createdAt_idx";

-- RenameIndex
ALTER INDEX "idx_assemblies_companyId" RENAME TO "assemblies_companyId_idx";

-- RenameIndex
ALTER INDEX "uq_assemblies_companyId_id" RENAME TO "assemblies_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_assemblies_companyId_legacyId" RENAME TO "assemblies_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "idx_assembly_components_assemblyId" RENAME TO "assembly_components_assemblyId_idx";

-- RenameIndex
ALTER INDEX "idx_assembly_components_companyId" RENAME TO "assembly_components_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_assembly_version_components_assemblyVersionId" RENAME TO "assembly_version_components_assemblyVersionId_idx";

-- RenameIndex
ALTER INDEX "idx_assembly_version_components_companyId" RENAME TO "assembly_version_components_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_assembly_versions_companyId" RENAME TO "assembly_versions_companyId_idx";

-- RenameIndex
ALTER INDEX "uq_assembly_versions_assemblyId_versionNumber" RENAME TO "assembly_versions_assemblyId_versionNumber_key";

-- RenameIndex
ALTER INDEX "uq_assembly_versions_companyId_id" RENAME TO "assembly_versions_companyId_id_key";

-- RenameIndex
ALTER INDEX "idx_audit_events_companyId_createdAt" RENAME TO "audit_events_companyId_createdAt_idx";

-- RenameIndex
ALTER INDEX "idx_audit_events_companyId_entityType_entityId" RENAME TO "audit_events_companyId_entityType_entityId_idx";

-- RenameIndex
ALTER INDEX "uq_companies_legacyId" RENAME TO "companies_legacyId_key";

-- RenameIndex
ALTER INDEX "uq_companies_slug" RENAME TO "companies_slug_key";

-- RenameIndex
ALTER INDEX "idx_company_feature_flag_overrides_companyId" RENAME TO "company_feature_flag_overrides_companyId_idx";

-- RenameIndex
ALTER INDEX "uq_company_feature_flag_overrides_companyId_featureFlagId" RENAME TO "company_feature_flag_overrides_companyId_featureFlagId_key";

-- RenameIndex
ALTER INDEX "idx_company_memberships_companyId" RENAME TO "company_memberships_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_company_memberships_userId" RENAME TO "company_memberships_userId_idx";

-- RenameIndex
ALTER INDEX "uq_company_memberships_companyId_userId" RENAME TO "company_memberships_companyId_userId_key";

-- RenameIndex
ALTER INDEX "uq_company_units_companyId_id" RENAME TO "company_units_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_company_units_companyId_name" RENAME TO "company_units_companyId_name_key";

-- RenameIndex
ALTER INDEX "idx_customer_order_items_assemblyId" RENAME TO "customer_order_items_assemblyId_idx";

-- RenameIndex
ALTER INDEX "idx_customer_order_items_companyId" RENAME TO "customer_order_items_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_customer_order_items_customerOrderId" RENAME TO "customer_order_items_customerOrderId_idx";

-- RenameIndex
ALTER INDEX "uq_customer_order_items_productionOrderId" RENAME TO "customer_order_items_productionOrderId_key";

-- RenameIndex
ALTER INDEX "idx_customer_orders_companyId_status" RENAME TO "customer_orders_companyId_status_idx";

-- RenameIndex
ALTER INDEX "uq_customer_orders_companyId_id" RENAME TO "customer_orders_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_customer_orders_companyId_legacyId" RENAME TO "customer_orders_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "idx_employees_companyId" RENAME TO "employees_companyId_idx";

-- RenameIndex
ALTER INDEX "uq_employees_companyId_id" RENAME TO "employees_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_employees_companyId_legacyId" RENAME TO "employees_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "uq_feature_flags_key" RENAME TO "feature_flags_key_key";

-- RenameIndex
ALTER INDEX "idx_file_assets_companyId_entityType_entityId" RENAME TO "file_assets_companyId_entityType_entityId_idx";

-- RenameIndex
ALTER INDEX "uq_file_assets_companyId_legacyId" RENAME TO "file_assets_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "idx_finished_goods_companyId_assemblyId" RENAME TO "finished_goods_companyId_assemblyId_idx";

-- RenameIndex
ALTER INDEX "idx_finished_goods_companyId_status" RENAME TO "finished_goods_companyId_status_idx";

-- RenameIndex
ALTER INDEX "idx_finished_goods_consumedInProductionOrderId" RENAME TO "finished_goods_consumedInProductionOrderId_idx";

-- RenameIndex
ALTER INDEX "idx_finished_goods_customerOrderId" RENAME TO "finished_goods_customerOrderId_idx";

-- RenameIndex
ALTER INDEX "uq_finished_goods_companyId_id" RENAME TO "finished_goods_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_finished_goods_companyId_legacyId" RENAME TO "finished_goods_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "uq_finished_goods_serialNumber" RENAME TO "finished_goods_serialNumber_key";

-- RenameIndex
ALTER INDEX "idx_inventory_items_companyId" RENAME TO "inventory_items_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_inventory_items_inventorySessionId" RENAME TO "inventory_items_inventorySessionId_idx";

-- RenameIndex
ALTER INDEX "idx_inventory_sessions_companyId" RENAME TO "inventory_sessions_companyId_idx";

-- RenameIndex
ALTER INDEX "uq_inventory_sessions_companyId_id" RENAME TO "inventory_sessions_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_inventory_sessions_companyId_legacyId" RENAME TO "inventory_sessions_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "idx_legacy_migration_runs_companyId" RENAME TO "legacy_migration_runs_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_payroll_entries_companyId_employeeId" RENAME TO "payroll_entries_companyId_employeeId_idx";

-- RenameIndex
ALTER INDEX "uq_payroll_entries_companyId_legacyId" RENAME TO "payroll_entries_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "idx_pending_ai_actions_companyId_status" RENAME TO "pending_ai_actions_companyId_status_idx";

-- RenameIndex
ALTER INDEX "uq_permissions_key" RENAME TO "permissions_key_key";

-- RenameIndex
ALTER INDEX "uq_plans_key" RENAME TO "plans_key_key";

-- RenameIndex
ALTER INDEX "idx_production_order_pick_list_items_companyId" RENAME TO "production_order_pick_list_items_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_production_order_pick_list_items_productionOrderId" RENAME TO "production_order_pick_list_items_productionOrderId_idx";

-- RenameIndex
ALTER INDEX "idx_production_order_stage_events_companyId" RENAME TO "production_order_stage_events_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_production_order_stage_events_productionOrderId" RENAME TO "production_order_stage_events_productionOrderId_idx";

-- RenameIndex
ALTER INDEX "idx_production_order_workers_companyId" RENAME TO "production_order_workers_companyId_idx";

-- RenameIndex
ALTER INDEX "uq_production_order_workers_productionOrderId_employeeId" RENAME TO "production_order_workers_productionOrderId_employeeId_key";

-- RenameIndex
ALTER INDEX "idx_production_orders_companyId_status" RENAME TO "production_orders_companyId_status_idx";

-- RenameIndex
ALTER INDEX "uq_production_orders_companyId_id" RENAME TO "production_orders_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_production_orders_companyId_legacyId" RENAME TO "production_orders_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "idx_production_stages_companyId" RENAME TO "production_stages_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_products_companyId_barcode" RENAME TO "products_companyId_barcode_idx";

-- RenameIndex
ALTER INDEX "idx_products_companyId_category" RENAME TO "products_companyId_category_idx";

-- RenameIndex
ALTER INDEX "idx_products_companyId_name" RENAME TO "products_companyId_name_idx";

-- RenameIndex
ALTER INDEX "idx_products_companyId_unitId" RENAME TO "products_companyId_unitId_idx";

-- RenameIndex
ALTER INDEX "uq_products_companyId_article" RENAME TO "products_companyId_article_key";

-- RenameIndex
ALTER INDEX "uq_products_companyId_id" RENAME TO "products_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_products_companyId_legacyId" RENAME TO "products_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "idx_purchase_order_items_companyId" RENAME TO "purchase_order_items_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_purchase_order_items_purchaseOrderId" RENAME TO "purchase_order_items_purchaseOrderId_idx";

-- RenameIndex
ALTER INDEX "idx_purchase_orders_companyId_status" RENAME TO "purchase_orders_companyId_status_idx";

-- RenameIndex
ALTER INDEX "uq_purchase_orders_companyId_id" RENAME TO "purchase_orders_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_purchase_orders_companyId_legacyId" RENAME TO "purchase_orders_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "idx_qc_check_results_companyId" RENAME TO "qc_check_results_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_qc_check_results_qcCheckId" RENAME TO "qc_check_results_qcCheckId_idx";

-- RenameIndex
ALTER INDEX "idx_qc_checklist_items_companyId" RENAME TO "qc_checklist_items_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_qc_checks_companyId_finishedGoodId" RENAME TO "qc_checks_companyId_finishedGoodId_idx";

-- RenameIndex
ALTER INDEX "uq_qc_checks_companyId_id" RENAME TO "qc_checks_companyId_id_key";

-- RenameIndex
ALTER INDEX "idx_refresh_tokens_expiresAt" RENAME TO "refresh_tokens_expiresAt_idx";

-- RenameIndex
ALTER INDEX "idx_refresh_tokens_familyId" RENAME TO "refresh_tokens_familyId_idx";

-- RenameIndex
ALTER INDEX "idx_refresh_tokens_userId" RENAME TO "refresh_tokens_userId_idx";

-- RenameIndex
ALTER INDEX "uq_refresh_tokens_tokenHash" RENAME TO "refresh_tokens_tokenHash_key";

-- RenameIndex
ALTER INDEX "idx_roles_companyId" RENAME TO "roles_companyId_idx";

-- RenameIndex
ALTER INDEX "uq_roles_companyId_id" RENAME TO "roles_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_roles_companyId_name" RENAME TO "roles_companyId_name_key";

-- RenameIndex
ALTER INDEX "idx_shipment_items_companyId" RENAME TO "shipment_items_companyId_idx";

-- RenameIndex
ALTER INDEX "idx_shipment_items_shipmentId" RENAME TO "shipment_items_shipmentId_idx";

-- RenameIndex
ALTER INDEX "idx_shipments_companyId_status" RENAME TO "shipments_companyId_status_idx";

-- RenameIndex
ALTER INDEX "uq_shipments_companyId_id" RENAME TO "shipments_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_shipments_companyId_legacyId" RENAME TO "shipments_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "idx_stock_movements_companyId_productId_createdAt" RENAME TO "stock_movements_companyId_productId_createdAt_idx";

-- RenameIndex
ALTER INDEX "idx_suppliers_companyId" RENAME TO "suppliers_companyId_idx";

-- RenameIndex
ALTER INDEX "uq_suppliers_companyId_legacyId" RENAME TO "suppliers_companyId_legacyId_key";

-- RenameIndex
ALTER INDEX "uq_users_email" RENAME TO "users_email_key";

-- RenameIndex
ALTER INDEX "uq_users_login" RENAME TO "users_login_key";

-- RenameIndex
ALTER INDEX "uq_warehouse_stock_companyId_productId_warehouseId" RENAME TO "warehouse_stock_companyId_productId_warehouseId_key";

-- RenameIndex
ALTER INDEX "idx_warehouses_companyId" RENAME TO "warehouses_companyId_idx";

-- RenameIndex
ALTER INDEX "uq_warehouses_companyId_id" RENAME TO "warehouses_companyId_id_key";

-- RenameIndex
ALTER INDEX "uq_warehouses_companyId_legacyId" RENAME TO "warehouses_companyId_legacyId_key";

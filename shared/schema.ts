import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, json, jsonb, boolean, numeric, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const items = pgTable("items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sku: text("sku").notNull().unique(),
  productName: text("product_name").notNull(),
  barcode: text("barcode"),
  currentStock: integer("current_stock").notNull().default(0),
  reservedStock: integer("reserved_stock").notNull().default(0),
  unitType: text("unit_type", { enum: ["pieces", "feet", "yards", "meters", "pounds", "kilograms", "tons", "rolls", "sheets", "gallons", "liters", "boxes", "pallets"] }).notNull().default("pieces"),
  unitCost: integer("unit_cost").default(0), // in cents
  reorderPoint: integer("reorder_point").default(0),
  maxStock: integer("max_stock"),
  location: text("location"),
  category: text("category"),
  status: text("status", { enum: ["available", "reserved", "checked-out", "low-stock", "out-of-stock"] }).notNull().default("available"),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderNumber: text("order_number").notNull().unique(),
  customer: text("customer").notNull(),
  status: text("status", { enum: ["pending", "in-progress", "on-hold", "fulfilled", "cancelled"] }).notNull().default("pending"),
  priority: text("priority", { enum: ["standard", "high", "urgent"] }).notNull().default("standard"),
  assignedTo: text("assigned_to"),
  completionPercentage: integer("completion_percentage").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  fulfilledAt: timestamp("fulfilled_at"),
});

export const orderItems = pgTable("order_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id),
  itemId: varchar("item_id").notNull().references(() => items.id),
  quantity: integer("quantity").notNull(),
  allocatedAt: timestamp("allocated_at").defaultNow(),
});

// Order activity logging table
export const orderActivities = pgTable("order_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  activityType: text("activity_type", { 
    enum: ["created", "item_added", "item_removed", "status_changed", "priority_changed", "assigned", "updated", "fulfilled", "cancelled", "work_order_created"] 
  }).notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata"), // For storing additional data like item details, old/new values
  createdAt: timestamp("created_at").defaultNow(),
});

// Enhanced Item transaction history to track comprehensive check-ins and check-outs
export const itemTransactions = pgTable("item_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull().references(() => items.id),
  orderId: varchar("order_id").references(() => orders.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  transactionType: text("transaction_type", { enum: ["check-in", "check-out"] }).notNull(),
  quantity: integer("quantity").notNull(),
  notes: text("notes"),
  reasonCode: text("reason_code", { enum: ["production", "quality-check", "repair", "inventory-adjustment", "customer-return", "damaged", "maintenance", "transfer", "other"] }),
  condition: text("condition", { enum: ["new", "good", "fair", "damaged", "defective"] }).default("good"),
  location: text("location"), // Where the transaction occurred
  workOrder: text("work_order"), // Associated work order number
  department: text("department"), // Department requesting/performing transaction
  urgency: text("urgency", { enum: ["low", "normal", "high", "critical"] }).default("normal"),
  estimatedReturnDate: timestamp("estimated_return_date"), // For check-outs
  actualReturnDate: timestamp("actual_return_date"), // When item was returned
  approvedBy: varchar("approved_by").references(() => users.id), // Manager/supervisor approval
  batchNumber: text("batch_number"), // For tracking batches
  serialNumbers: text("serial_numbers").array(), // For serialized items
  attachments: json("attachments"), // Photos, documents, etc.
  clientIpAddress: text("client_ip_address"), // For audit trail
  deviceInfo: json("device_info"), // Browser/device information
  geoLocation: json("geo_location"), // Location coordinates if available
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertItemSchema = createInsertSchema(items).pick({
  sku: true,
  productName: true,
  barcode: true,
  currentStock: true,
  unitType: true,
  unitCost: true,
  reorderPoint: true,
  maxStock: true,
  location: true,
  category: true,
});

export const updateItemSchema = createInsertSchema(items).pick({
  sku: true,
  productName: true,
  barcode: true,
  currentStock: true,
  unitType: true,
  unitCost: true,
  reorderPoint: true,
  maxStock: true,
  location: true,
  category: true,
  status: true,
}).partial();

export const insertOrderSchema = createInsertSchema(orders).pick({
  orderNumber: true,
  customer: true,
  priority: true,
  assignedTo: true,
  completionPercentage: true,
  notes: true,
});

export const updateOrderSchema = createInsertSchema(orders).pick({
  orderNumber: true,
  customer: true,
  status: true,
  priority: true,
  assignedTo: true,
  completionPercentage: true,
  notes: true,
}).partial();

export const insertOrderItemSchema = createInsertSchema(orderItems).pick({
  orderId: true,
  itemId: true,
  quantity: true,
});

export const insertOrderActivitySchema = createInsertSchema(orderActivities).pick({
  orderId: true,
  userId: true,
  activityType: true,
  description: true,
  metadata: true,
});

export const insertItemTransactionSchema = createInsertSchema(itemTransactions).pick({
  itemId: true,
  orderId: true,
  userId: true,
  transactionType: true,
  quantity: true,
  notes: true,
  reasonCode: true,
  condition: true,
  location: true,
  workOrder: true,
  department: true,
  urgency: true,
  estimatedReturnDate: true,
  approvedBy: true,
  batchNumber: true,
  serialNumbers: true,
  attachments: true,
});

export const checkoutSchema = z.object({
  orderId: z.string().optional(),
  customer: z.string().optional(),
  priority: z.enum(["standard", "high", "urgent"]).default("standard"),
  notes: z.string().optional(),
  items: z.array(z.object({
    itemId: z.string(),
    quantity: z.number().min(1),
  })).min(1, "At least one item is required"),
});

export const checkoutItemSchema = z.object({
  itemId: z.string(),
  quantity: z.number().min(1),
  orderId: z.string().optional(),
  reasonCode: z.enum(["production", "quality-check", "repair", "inventory-adjustment", "customer-return", "damaged", "maintenance", "transfer", "other"]).optional(),
  condition: z.enum(["new", "good", "fair", "damaged", "defective"]).default("good"),
  location: z.string().optional(),
  workOrder: z.string().optional(),
  department: z.string().optional(),
  urgency: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  estimatedReturnDate: z.date().optional(),
  approvedBy: z.string().optional(),
  batchNumber: z.string().optional(),
  serialNumbers: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const checkinSchema = z.object({
  itemId: z.string(),
  quantity: z.number().min(1),
  notes: z.string().optional(),
  reasonCode: z.enum(["production", "quality-check", "repair", "inventory-adjustment", "customer-return", "damaged", "maintenance", "transfer", "other"]).optional(),
  condition: z.enum(["new", "good", "fair", "damaged", "defective"]).default("good"),
  location: z.string().optional(),
  workOrder: z.string().optional(),
  department: z.string().optional(),
  batchNumber: z.string().optional(),
  serialNumbers: z.array(z.string()).optional(),
  actualReturnDate: z.date().optional(),
});

export type InsertItem = z.infer<typeof insertItemSchema>;
export type UpdateItem = z.infer<typeof updateItemSchema>;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type UpdateOrder = z.infer<typeof updateOrderSchema>;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type InsertOrderActivity = z.infer<typeof insertOrderActivitySchema>;
export type InsertItemTransaction = z.infer<typeof insertItemTransactionSchema>;
export type CheckoutRequest = z.infer<typeof checkoutSchema>;
export type CheckoutItemRequest = z.infer<typeof checkoutItemSchema>;
export type CheckinRequest = z.infer<typeof checkinSchema>;

export type Item = typeof items.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderActivity = typeof orderActivities.$inferSelect;
export type ItemTransaction = typeof itemTransactions.$inferSelect;

export type OrderWithItems = Order & {
  items: (OrderItem & { item: Item })[];
  activities?: (OrderActivity & { user: { firstName: string; lastName: string; username: string } })[];
};

export type ItemWithStatus = Item & {
  availableStock: number;
};

// User management schemas - working with existing structure
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull(), // Employee barcode/ID
  email: text("email"),
  password: text("password"),
  role: text("role", { enum: ["admin", "manager", "worker", "viewer"] }).notNull().default("worker"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  department: text("department"),
  phoneNumber: text("phone_number"),
  profileImageUrl: text("profile_image_url"),
  lastLogin: timestamp("last_login"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const systemSettings = pgTable("system_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siteName: text("site_name").notNull(),
  companyName: text("company_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  allowUserRegistration: boolean("allow_user_registration").notNull().default(false),
  requireEmailVerification: boolean("require_email_verification").notNull().default(true),
  sessionTimeout: integer("session_timeout").notNull().default(60),
  maxLoginAttempts: integer("max_login_attempts").notNull().default(5),
  passwordMinLength: integer("password_min_length").notNull().default(8),
  requirePasswordComplexity: boolean("require_password_complexity").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const loginSchema = z.object({
  employeeBarcode: z.string().min(1, "Employee barcode is required"),
});

export const createUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  username: z.string().min(1, "Employee barcode is required"),
  email: z.string().email().optional(),
  role: z.enum(["admin", "manager", "worker", "viewer"]).default("worker"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  department: z.string().optional(),
  phoneNumber: z.string().optional(),
});

export const updateUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  username: z.string().min(1, "Employee barcode is required"),
  email: z.string().email().optional(),
  role: z.enum(["admin", "manager", "worker", "viewer"]),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  department: z.string().optional(),
  phoneNumber: z.string().optional(),
}).partial();

// System settings schema
export const systemSettingsSchema = z.object({
  siteName: z.string().min(1, "Site name is required"),
  companyName: z.string().min(1, "Company name is required"),
  contactEmail: z.string().email("Invalid email address"),
  maintenanceMode: z.boolean(),
  allowUserRegistration: z.boolean(),
  requireEmailVerification: z.boolean(),
  sessionTimeout: z.number().min(5).max(480), // 5 minutes to 8 hours
  maxLoginAttempts: z.number().min(3).max(10),
  passwordMinLength: z.number().min(6).max(20),
  requirePasswordComplexity: z.boolean(),
});

export type SystemSettings = z.infer<typeof systemSettingsSchema>;
export type LoginData = z.infer<typeof loginSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;

// Shipping and receiving schemas
export const shipments = pgTable("shipments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shipmentNumber: text("shipment_number").notNull().unique(),
  orderId: varchar("order_id").references(() => orders.id),
  customerName: text("customer_name").notNull(),
  customerAddress: text("customer_address").notNull(),
  customerCity: text("customer_city").notNull(),
  customerState: text("customer_state").notNull(),
  customerZip: text("customer_zip").notNull(),
  shippingMethod: text("shipping_method", { enum: ["ground", "express", "overnight", "freight", "pickup"] }).notNull(),
  trackingNumber: text("tracking_number"),
  carrier: text("carrier", { enum: ["ups", "fedex", "usps", "dhl", "freight", "other"] }),
  weight: integer("weight"), // in pounds
  dimensions: text("dimensions"), // LxWxH
  shippingCost: integer("shipping_cost"), // in cents
  status: text("status", { enum: ["pending", "picked", "packed", "shipped", "delivered", "returned"] }).notNull().default("pending"),
  scheduledPickup: timestamp("scheduled_pickup"),
  actualPickup: timestamp("actual_pickup"),
  estimatedDelivery: timestamp("estimated_delivery"),
  actualDelivery: timestamp("actual_delivery"),
  bolGenerated: boolean("bol_generated").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const receivingOrders = pgTable("receiving_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poNumber: text("po_number").notNull().unique(),
  supplierName: text("supplier_name").notNull(),
  supplierContact: text("supplier_contact"),
  expectedDate: timestamp("expected_date"),
  actualDate: timestamp("actual_date"),
  status: text("status", { enum: ["pending", "partial", "complete", "cancelled"] }).notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const receivingItems = pgTable("receiving_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  receivingOrderId: varchar("receiving_order_id").notNull().references(() => receivingOrders.id),
  itemId: varchar("item_id").notNull().references(() => items.id),
  expectedQuantity: integer("expected_quantity").notNull(),
  receivedQuantity: integer("received_quantity").notNull().default(0),
  condition: text("condition", { enum: ["good", "damaged", "defective"] }).notNull().default("good"),
  lotNumber: text("lot_number"),
  expirationDate: timestamp("expiration_date"),
  notes: text("notes"),
});

// Receiving order schemas
export const insertReceivingOrderSchema = createInsertSchema(receivingOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReceivingItemSchema = createInsertSchema(receivingItems).omit({
  id: true,
});

export type ReceivingOrder = typeof receivingOrders.$inferSelect;
export type InsertReceivingOrder = z.infer<typeof insertReceivingOrderSchema>;
export type ReceivingItem = typeof receivingItems.$inferSelect;
export type InsertReceivingItem = z.infer<typeof insertReceivingItemSchema>;

export type AppUser = typeof users.$inferSelect;
export type LoginRequest = z.infer<typeof loginSchema>;
export type CreateUserRequest = z.infer<typeof createUserSchema>;

// Relations
export const itemsRelations = relations(items, ({ many }) => ({
  orderItems: many(orderItems),
}));

export const ordersRelations = relations(orders, ({ many }) => ({
  orderItems: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  item: one(items, {
    fields: [orderItems.itemId],
    references: [items.id],
  }),
}));

// Work orders table
export const workOrders = pgTable("work_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: text("priority", { enum: ["low", "standard", "high", "urgent"] }).notNull().default("standard"),
  category: text("category", { enum: ["production", "maintenance", "shipping", "receiving", "custom"] }).notNull().default("custom"),
  status: text("status", { enum: ["pending", "in-progress", "on-hold", "completed", "cancelled"] }).notNull().default("pending"),
  estimatedHours: numeric("estimated_hours").notNull(),
  estimatedCost: numeric("estimated_cost").notNull(),
  actualCost: numeric("actual_cost"),
  dueDate: timestamp("due_date"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  materials: jsonb("materials"),
  tasks: jsonb("tasks"),
  specialInstructions: text("special_instructions"),
  safetyRequirements: text("safety_requirements"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  actualCost: true,
});

export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;

// Time Clock System Tables
export const clockEmployees = pgTable("clock_employees", {
  id: varchar("id").primaryKey(),
  name: varchar("name").notNull(),
  pin: varchar("pin"),
  payRate: numeric("pay_rate", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { enum: ["inactive", "working", "on-lunch"] }).default("inactive"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const clockLogs = pgTable("clock_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => clockEmployees.id).notNull(),
  type: varchar("type", { enum: ["clock-in", "clock-out", "lunch-out", "lunch-in"] }).notNull(),
  timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  deviceId: varchar("device_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Clock system schemas
export const insertClockEmployeeSchema = createInsertSchema(clockEmployees).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertClockLogSchema = createInsertSchema(clockLogs).omit({
  id: true,
  createdAt: true,
});

export type ClockEmployee = typeof clockEmployees.$inferSelect;
export type InsertClockEmployee = z.infer<typeof insertClockEmployeeSchema>;
export type ClockLog = typeof clockLogs.$inferSelect;
export type InsertClockLog = z.infer<typeof insertClockLogSchema>;

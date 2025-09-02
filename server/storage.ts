import { type Item, type Order, type OrderItem, type OrderActivity, type InsertItem, type UpdateItem, type InsertOrder, type InsertOrderItem, type InsertOrderActivity, type OrderWithItems, type ItemWithStatus, type AppUser, type CreateUserRequest, type SystemSettings, type ItemTransaction, type InsertItemTransaction, type ReceivingOrder, type InsertReceivingOrder, type ReceivingItem, type ClockEmployee, type InsertClockEmployee, type ClockLog, type InsertClockLog, type WorkOrder, type InsertWorkOrder, items, orders, orderItems, orderActivities, users, itemTransactions, systemSettings, receivingOrders, receivingItems, clockEmployees, clockLogs, workOrders } from "@shared/schema";
import { db, pool } from "./db";
import { eq, and, sql, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  // Settings operations
  getSystemSettings(): Promise<SystemSettings>;
  updateSystemSettings(settings: SystemSettings): Promise<SystemSettings>;
  // Items
  getItems(): Promise<ItemWithStatus[]>;
  getItem(id: string): Promise<Item | undefined>;
  getItemBySku(sku: string): Promise<Item | undefined>;
  createItem(item: InsertItem): Promise<Item>;
  updateItem(id: string, updates: UpdateItem): Promise<Item | undefined>;
  deleteItem(id: string): Promise<boolean>;
  
  // Orders
  getOrders(): Promise<OrderWithItems[]>;
  getOrder(id: string): Promise<OrderWithItems | undefined>;
  createOrder(order: InsertOrder): Promise<Order>;
  updateOrder(id: string, updates: Partial<Order>): Promise<Order | undefined>;
  deleteOrder(id: string): Promise<boolean>;
  
  // Order Items
  addOrderItem(orderItem: InsertOrderItem): Promise<OrderItem>;
  removeOrderItem(id: string): Promise<boolean>;
  getOrderItems(orderId: string): Promise<(OrderItem & { item: Item })[]>;
  
  // Order Activities
  createOrderActivity(activity: InsertOrderActivity): Promise<OrderActivity>;
  getOrderActivities(orderId: string): Promise<(OrderActivity & { user: { firstName: string; lastName: string; username: string } })[]>;
  
  // Item Transactions
  createItemTransaction(transaction: InsertItemTransaction): Promise<ItemTransaction>;
  getItemTransactions(itemId?: string): Promise<(ItemTransaction & { item: Item; user: AppUser })[]>;
  checkInItem(itemId: string, quantity: number, userId: string, notes?: string): Promise<void>;
  
  // Analytics
  getInventoryStats(): Promise<{
    totalItems: number;
    activeOrders: number;
    lowStockItems: number;
    monthlyOrders: number;
  }>;
  
  // Users
  getUsers(): Promise<AppUser[]>;
  getUser(id: string): Promise<AppUser | undefined>;
  getUserByBarcode(employeeBarcode: string): Promise<AppUser | undefined>;
  createUser(user: CreateUserRequest): Promise<AppUser>;
  updateUser(id: string, updates: Partial<AppUser>): Promise<AppUser | undefined>;
  deleteUser(id: string): Promise<boolean>;
  authenticateUser(employeeBarcode: string): Promise<AppUser | null>;
  verifyAndUpdatePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean>;
  
  // Receiving Orders
  getReceivingOrders(): Promise<ReceivingOrder[]>;
  getReceivingOrder(id: string): Promise<ReceivingOrder | undefined>;
  createReceivingOrder(order: InsertReceivingOrder): Promise<ReceivingOrder>;
  updateReceivingOrder(id: string, updates: Partial<ReceivingOrder>): Promise<ReceivingOrder | undefined>;
  deleteReceivingOrder(id: string): Promise<boolean>;
  receiveItem(orderId: string, itemData: { itemId: string; receivedQuantity: number; condition: string; lotNumber?: string; notes?: string }): Promise<ReceivingItem | undefined>;
  
  // Activity logging
  createActivity(activity: { userId: string; activityType: string; description: string; tableName: string; recordId: string; metadata?: any }): Promise<void>;
  
  // Clock System
  getClockEmployees(): Promise<ClockEmployee[]>;
  getClockEmployee(id: string): Promise<ClockEmployee | undefined>;
  createClockEmployee(employee: InsertClockEmployee): Promise<ClockEmployee>;
  updateClockEmployee(id: string, updates: Partial<ClockEmployee>): Promise<ClockEmployee | undefined>;
  deleteClockEmployee(id: string): Promise<boolean>;
  clockAction(employeeId: string): Promise<{ employee: ClockEmployee; status: string; log: ClockLog }>;
  getClockLogs(employeeId?: string): Promise<ClockLog[]>;
  
  // Work Orders
  getWorkOrders(): Promise<WorkOrder[]>;
  getWorkOrder(id: string): Promise<WorkOrder | undefined>;
  createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder>;
  updateWorkOrder(id: string, updates: Partial<WorkOrder>): Promise<WorkOrder | undefined>;
  deleteWorkOrder(id: string): Promise<boolean>;
  getEmployeeTimeCard(employeeId: string, startDate: Date, endDate: Date): Promise<any>;
  exportAllHours(startDate: Date, endDate: Date): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  async getItems(): Promise<ItemWithStatus[]> {
    const result = await db.select().from(items);
    return result.map(item => ({
      ...item,
      availableStock: item.currentStock - item.reservedStock,
    }));
  }

  async getItem(id: string): Promise<Item | undefined> {
    const [item] = await db.select().from(items).where(eq(items.id, id));
    return item || undefined;
  }

  async getItemBySku(sku: string): Promise<Item | undefined> {
    const [item] = await db.select().from(items).where(eq(items.sku, sku));
    return item || undefined;
  }

  async createItem(insertItem: InsertItem): Promise<Item> {
    const [item] = await db
      .insert(items)
      .values({
        sku: insertItem.sku,
        productName: insertItem.productName,
        barcode: insertItem.barcode || null,
        currentStock: insertItem.currentStock || 0,
      })
      .returning();
    return item;
  }

  async updateItem(id: string, updates: UpdateItem): Promise<Item | undefined> {
    const [item] = await db
      .update(items)
      .set(updates)
      .where(eq(items.id, id))
      .returning();
    return item || undefined;
  }

  async deleteItem(id: string): Promise<boolean> {
    const result = await db.delete(items).where(eq(items.id, id));
    return (result.rowCount || 0) > 0;
  }

  async getOrders(): Promise<OrderWithItems[]> {
    const queryResult = await db
      .select()
      .from(orders)
      .leftJoin(orderItems, eq(orders.id, orderItems.orderId))
      .leftJoin(items, eq(orderItems.itemId, items.id));
    
    const ordersMap = new Map<string, OrderWithItems>();
    
    for (const row of queryResult) {
      const order = row.orders;
      if (!ordersMap.has(order.id)) {
        ordersMap.set(order.id, {
          ...order,
          items: [],
          activities: [],
        });
      }
      
      if (row.order_items && row.items) {
        ordersMap.get(order.id)!.items.push({
          ...row.order_items,
          item: row.items,
        });
      }
    }
    
    // Get activities for each order
    const ordersArray = Array.from(ordersMap.values());
    for (const order of ordersArray) {
      const activities = await this.getOrderActivities(order.id);
      order.activities = activities;
    }
    
    return ordersArray.sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime());
  }

  async getOrder(id: string): Promise<OrderWithItems | undefined> {
    const queryResult = await db
      .select()
      .from(orders)
      .leftJoin(orderItems, eq(orders.id, orderItems.orderId))
      .leftJoin(items, eq(orderItems.itemId, items.id))
      .where(eq(orders.id, id));
    
    if (queryResult.length === 0) return undefined;
    
    const order = queryResult[0].orders;
    const orderItemsData = queryResult
      .filter(row => row.order_items && row.items)
      .map(row => ({
        ...row.order_items!,
        item: row.items!,
      }));
    
    // Get activities for the order
    const activities = await this.getOrderActivities(order.id);
    
    return {
      ...order,
      items: orderItemsData,
      activities,
    };
  }

  async createOrder(insertOrder: InsertOrder): Promise<Order> {
    const [order] = await db
      .insert(orders)
      .values({
        orderNumber: insertOrder.orderNumber,
        customer: insertOrder.customer,
        priority: insertOrder.priority || "standard",
        assignedTo: insertOrder.assignedTo || null,
        completionPercentage: insertOrder.completionPercentage || 0,
        notes: insertOrder.notes || null,
      })
      .returning();
    return order;
  }

  async updateOrder(id: string, updates: Partial<Order>): Promise<Order | undefined> {
    const [order] = await db
      .update(orders)
      .set(updates)
      .where(eq(orders.id, id))
      .returning();
    return order || undefined;
  }

  async deleteOrder(id: string): Promise<boolean> {
    try {
      // First check if order exists
      const [existingOrder] = await db.select().from(orders).where(eq(orders.id, id));
      if (!existingOrder) {
        return false;
      }

      // 1. Delete item transactions first (foreign key dependency)
      await db.delete(itemTransactions).where(eq(itemTransactions.orderId, id));

      // 2. Delete order activities
      await db.delete(orderActivities).where(eq(orderActivities.orderId, id));
      
      // 3. Delete all order items and restore reserved stock
      const orderItemsToDelete = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
      for (const orderItem of orderItemsToDelete) {
        // Restore reserved stock
        await db
          .update(items)
          .set({
            reservedStock: sql`${items.reservedStock} - ${orderItem.quantity}`,
          })
          .where(eq(items.id, orderItem.itemId));
      }
      
      // 4. Delete order items
      await db.delete(orderItems).where(eq(orderItems.orderId, id));
      
      // 5. Finally delete the order
      const result = await db.delete(orders).where(eq(orders.id, id));
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error('Error deleting order:', error);
      throw error;
    }
  }

  async addOrderItem(orderItem: InsertOrderItem): Promise<OrderItem> {
    const [item] = await db
      .insert(orderItems)
      .values(orderItem)
      .returning();
    
    // Update item reserved stock
    await db
      .update(items)
      .set({
        reservedStock: sql`${items.reservedStock} + ${orderItem.quantity}`,
      })
      .where(eq(items.id, orderItem.itemId));
    
    return item;
  }

  async removeOrderItem(id: string): Promise<boolean> {
    const [orderItem] = await db.select().from(orderItems).where(eq(orderItems.id, id));
    if (!orderItem) return false;
    
    // Update item reserved stock
    await db
      .update(items)
      .set({
        reservedStock: sql`${items.reservedStock} - ${orderItem.quantity}`,
      })
      .where(eq(items.id, orderItem.itemId));
    
    const result = await db.delete(orderItems).where(eq(orderItems.id, id));
    return (result.rowCount || 0) > 0;
  }

  async getOrderItems(orderId: string): Promise<(OrderItem & { item: Item })[]> {
    const result = await db
      .select()
      .from(orderItems)
      .innerJoin(items, eq(orderItems.itemId, items.id))
      .where(eq(orderItems.orderId, orderId));
    
    return result.map(row => ({
      ...row.order_items,
      item: row.items,
    }));
  }

  // Item transaction methods
  async createItemTransaction(transaction: InsertItemTransaction): Promise<ItemTransaction> {
    try {
      const query = `
        INSERT INTO item_transactions (item_id, user_id, order_id, transaction_type, quantity, notes, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        RETURNING id, item_id, user_id, order_id, transaction_type, quantity, notes, created_at
      `;
      
      const result = await pool.query(query, [
        transaction.itemId,
        transaction.userId,
        transaction.orderId || null,
        transaction.transactionType,
        transaction.quantity,
        transaction.notes || null
      ]);
      
      const row = result.rows[0];
      return {
        id: row.id,
        itemId: row.item_id,
        userId: row.user_id,
        orderId: row.order_id,
        transactionType: row.transaction_type,
        quantity: row.quantity,
        notes: row.notes,
        createdAt: new Date(row.created_at)
      };
    } catch (error) {
      console.error("Error creating transaction:", error);
      throw new Error("Failed to create transaction");
    }
  }

  async getItemTransactions(itemId?: string): Promise<(ItemTransaction & { item: Item; user: AppUser })[]> {
    try {
      let query = `
        SELECT 
          t.id, t.item_id, t.user_id, t.order_id, t.transaction_type, t.quantity, t.notes, t.created_at,
          i.sku, i.product_name, i.barcode, i.current_stock, i.reserved_stock, i.status,
          u.username, u.first_name, u.last_name, u.role
        FROM item_transactions t
        INNER JOIN items i ON t.item_id = i.id
        INNER JOIN users u ON t.user_id = u.id
      `;
      
      const values: any[] = [];
      if (itemId) {
        query += ' WHERE t.item_id = $1';
        values.push(itemId);
      }
      
      query += ' ORDER BY t.created_at DESC';
      
      const result = await pool.query(query, values);
      
      return result.rows.map(row => ({
        id: row.id,
        itemId: row.item_id,
        userId: row.user_id,
        orderId: row.order_id,
        transactionType: row.transaction_type as 'check-in' | 'check-out',
        quantity: row.quantity,
        notes: row.notes,
        createdAt: new Date(row.created_at),
        item: {
          id: row.item_id,
          sku: row.sku,
          productName: row.product_name,
          barcode: row.barcode,
          currentStock: row.current_stock,
          reservedStock: row.reserved_stock,
          status: row.status,
          unitType: 'pieces',
          unitCost: null,
          reorderPoint: null,
          maxStock: null,
          location: null,
          category: null,
          createdAt: new Date(),
          lastUpdated: new Date()
        } as Item,
        user: {
          id: row.user_id,
          name: (row.first_name && row.last_name) 
            ? `${row.first_name} ${row.last_name}`.trim()
            : row.username,
          employeeBarcode: row.username,
          role: row.role,
          active: true,
          createdAt: new Date()
        } as AppUser
      }));
    } catch (error) {
      console.error("Error fetching transactions:", error);
      throw new Error("Failed to get transaction history");
    }
  }

  async checkInItem(itemId: string, quantity: number, userId: string, notes?: string, enhancedData?: any): Promise<void> {
    try {
      // Begin transaction
      await pool.query('BEGIN');
      
      // Update item stock (add back to current stock, reduce reserved stock)
      await pool.query(`
        UPDATE items SET 
          current_stock = current_stock + $1,
          reserved_stock = reserved_stock - $1,
          status = CASE 
            WHEN current_stock + $1 > 0 THEN 'available' 
            ELSE status 
          END,
          last_updated = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [quantity, itemId]);

      // Record enhanced transaction
      const transactionQuery = `
        INSERT INTO item_transactions (
          item_id, user_id, transaction_type, quantity, notes, 
          reason_code, condition, location, work_order, department, 
          batch_number, serial_numbers, actual_return_date, created_at
        )
        VALUES ($1, $2, 'check-in', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      `;
      
      await pool.query(transactionQuery, [
        itemId, 
        userId, 
        quantity, 
        notes,
        enhancedData?.reasonCode,
        enhancedData?.condition || 'good',
        enhancedData?.location,
        enhancedData?.workOrder,
        enhancedData?.department,
        enhancedData?.batchNumber,
        enhancedData?.serialNumbers ? JSON.stringify(enhancedData.serialNumbers) : null,
        enhancedData?.actualReturnDate
      ]);
      
      // Commit transaction
      await pool.query('COMMIT');
    } catch (error) {
      // Rollback on error
      await pool.query('ROLLBACK');
      console.error("Error checking in item:", error);
      throw new Error("Failed to check in item");
    }
  }

  async getInventoryStats(): Promise<{
    totalItems: number;
    activeOrders: number;
    lowStockItems: number;
    monthlyOrders: number;
  }> {
    const [totalItems] = await db.select({ count: sql<number>`count(*)` }).from(items);
    
    const [activeOrders] = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.status, "pending"));
    
    const [lowStockItems] = await db
      .select({ count: sql<number>`count(*)` })
      .from(items)
      .where(sql`${items.currentStock} < 10`);
    
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [monthlyOrders] = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(sql`${orders.createdAt} >= ${monthStart}`);

    return {
      totalItems: totalItems.count,
      activeOrders: activeOrders.count,
      lowStockItems: lowStockItems.count,
      monthlyOrders: monthlyOrders.count,
    };
  }

  async getUsers(): Promise<AppUser[]> {
    try {
      const query = `
        SELECT id, username, first_name, last_name, role, active, created_at, email, department
        FROM users 
        WHERE active = true
        ORDER BY created_at DESC
      `;
      
      const result = await pool.query(query);
      
      return result.rows.map(row => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        username: row.username,
        email: row.email,
        role: row.role,
        department: row.department,
        active: row.active === true || row.active === 't' || row.active === 'true',
        createdAt: new Date(row.created_at || new Date())
      }));
    } catch (error) {
      console.error("Error fetching users:", error);
      throw new Error("Failed to fetch users");
    }
  }

  async getEnhancedTransactions(filters: {
    itemId?: string;
    userId?: string;
    department?: string;
    urgency?: string;
    reasonCode?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<any[]> {
    try {
      let whereConditions = ['1=1'];
      const queryParams: any[] = [];
      let paramCount = 0;

      if (filters.itemId) {
        paramCount++;
        whereConditions.push(`t.item_id = $${paramCount}`);
        queryParams.push(filters.itemId);
      }

      if (filters.userId) {
        paramCount++;
        whereConditions.push(`t.user_id = $${paramCount}`);
        queryParams.push(filters.userId);
      }

      if (filters.department) {
        paramCount++;
        whereConditions.push(`t.department = $${paramCount}`);
        queryParams.push(filters.department);
      }

      if (filters.urgency) {
        paramCount++;
        whereConditions.push(`t.urgency = $${paramCount}`);
        queryParams.push(filters.urgency);
      }

      if (filters.reasonCode) {
        paramCount++;
        whereConditions.push(`t.reason_code = $${paramCount}`);
        queryParams.push(filters.reasonCode);
      }

      if (filters.dateFrom) {
        paramCount++;
        whereConditions.push(`t.created_at >= $${paramCount}`);
        queryParams.push(filters.dateFrom);
      }

      if (filters.dateTo) {
        paramCount++;
        whereConditions.push(`t.created_at <= $${paramCount}`);
        queryParams.push(filters.dateTo);
      }

      const query = `
        SELECT 
          t.id,
          t.item_id,
          t.user_id,
          t.order_id,
          t.transaction_type,
          t.quantity,
          t.notes,
          t.reason_code,
          t.condition,
          t.location,
          t.work_order,
          t.department,
          t.urgency,
          t.estimated_return_date,
          t.actual_return_date,
          t.approved_by,
          t.batch_number,
          t.serial_numbers,
          t.created_at,
          i.sku,
          i.product_name,
          u.first_name || ' ' || u.last_name as user_name,
          u.username as user_barcode
        FROM item_transactions t
        LEFT JOIN items i ON t.item_id = i.id
        LEFT JOIN users u ON t.user_id = u.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY t.created_at DESC
        LIMIT 500
      `;

      const result = await pool.query(query, queryParams);
      
      return result.rows.map(row => ({
        id: row.id,
        itemId: row.item_id,
        userId: row.user_id,
        orderId: row.order_id,
        transactionType: row.transaction_type,
        quantity: row.quantity,
        notes: row.notes,
        reasonCode: row.reason_code,
        condition: row.condition,
        location: row.location,
        workOrder: row.work_order,
        department: row.department,
        urgency: row.urgency,
        estimatedReturnDate: row.estimated_return_date,
        actualReturnDate: row.actual_return_date,
        approvedBy: row.approved_by,
        batchNumber: row.batch_number,
        serialNumbers: row.serial_numbers ? JSON.parse(row.serial_numbers) : [],
        createdAt: row.created_at,
        item: {
          sku: row.sku,
          productName: row.product_name
        },
        user: {
          name: row.user_name || row.user_barcode,
          barcode: row.user_barcode
        }
      }));
    } catch (error) {
      console.error("Error fetching enhanced transactions:", error);
      throw new Error("Failed to get enhanced transaction history");
    }
  }

  async getUser(id: string): Promise<AppUser | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByBarcode(employeeBarcode: string): Promise<AppUser | undefined> {
    const [user] = await db.select().from(users).where(eq(users.employeeBarcode, employeeBarcode));
    return user || undefined;
  }

  async createUser(userData: CreateUserRequest): Promise<AppUser> {
    try {
      const query = `
        INSERT INTO users (id, username, email, password, first_name, last_name, role, active, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, CURRENT_TIMESTAMP)
        RETURNING id, username, first_name, last_name, role, active, created_at, email
      `;
      
      // Split name into first and last name
      const nameParts = (userData.name || '').trim().split(' ');
      const firstName = nameParts[0] || userData.employeeBarcode;
      const lastName = nameParts.slice(1).join(' ') || '';
      
      const result = await pool.query(query, [
        userData.employeeBarcode, // username
        (userData as any).email || `${userData.employeeBarcode}@pucudamfg.com`, // email
        (userData as any).password || '123456', // default password
        firstName,
        lastName,
        userData.role || 'worker'
      ]);
      
      const row = result.rows[0];
      return {
        id: row.id,
        name: (row.first_name && row.last_name) 
          ? `${row.first_name} ${row.last_name}`.trim()
          : row.username,
        employeeBarcode: row.username,
        role: row.role,
        active: row.active === true || row.active === 't' || row.active === 'true',
        createdAt: new Date(row.created_at)
      } as AppUser;
    } catch (error) {
      console.error("Error creating user:", error);
      throw new Error("Failed to create user");
    }
  }

  async updateUser(id: string, updates: Partial<AppUser>): Promise<AppUser | undefined> {
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      if (updates.name) {
        const nameParts = updates.name.trim().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        setParts.push(`first_name = $${paramIndex++}`, `last_name = $${paramIndex++}`);
        values.push(firstName, lastName);
      }
      
      if (updates.employeeBarcode) {
        setParts.push(`username = $${paramIndex++}`);
        values.push(updates.employeeBarcode);
      }
      
      if (updates.role) {
        setParts.push(`role = $${paramIndex++}`);
        values.push(updates.role);
      }
      
      if ((updates as any).email) {
        setParts.push(`email = $${paramIndex++}`);
        values.push((updates as any).email);
      }
      
      if ((updates as any).password) {
        setParts.push(`password = $${paramIndex++}`);
        values.push((updates as any).password);
      }
      
      setParts.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);
      
      const query = `
        UPDATE users SET ${setParts.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, username, first_name, last_name, role, active, created_at, email
      `;
      
      const result = await pool.query(query, values);
      
      if (result.rows.length === 0) return undefined;
      
      const row = result.rows[0];
      return {
        id: row.id,
        name: (row.first_name && row.last_name) 
          ? `${row.first_name} ${row.last_name}`.trim()
          : row.username,
        employeeBarcode: row.username,
        role: row.role,
        active: row.active === true || row.active === 't' || row.active === 'true',
        createdAt: new Date(row.created_at)
      } as AppUser;
    } catch (error) {
      console.error("Error updating user:", error);
      throw new Error("Failed to update user");
    }
  }

  async deleteUser(id: string): Promise<boolean> {
    try {
      // Soft delete - mark as inactive instead of removing
      const query = `
        UPDATE users SET active = false, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `;
      
      const result = await pool.query(query, [id]);
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error("Error deleting user:", error);
      throw new Error("Failed to delete user");
    }
  }

  async authenticateUser(employeeBarcode: string): Promise<AppUser | null> {
    try {
      // Use direct pool query to work with existing database structure
      const query = `
        SELECT id, username, first_name, last_name, role, active
        FROM users 
        WHERE username = $1 AND active = true
        LIMIT 1
      `;
      
      const result = await pool.query(query, [employeeBarcode]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      
      const fullName = (row.first_name && row.last_name) 
        ? `${row.first_name} ${row.last_name}`.trim()
        : row.username;
      
      const user: AppUser = {
        id: row.id,
        name: fullName,
        employeeBarcode: row.username,
        role: row.role,
        active: row.active === true || row.active === 't' || row.active === 'true',
        createdAt: new Date()
      };
      
      return user;
      
    } catch (error) {
      console.error("Database authentication error:", error);
      return null;
    }
  }

  async getSystemSettings(): Promise<SystemSettings> {
    try {
      const [settings] = await db.select().from(systemSettings).limit(1);
      if (settings) {
        return {
          siteName: settings.siteName,
          companyName: settings.companyName,
          contactEmail: settings.contactEmail,
          maintenanceMode: settings.maintenanceMode,
          allowUserRegistration: settings.allowUserRegistration,
          requireEmailVerification: settings.requireEmailVerification,
          sessionTimeout: settings.sessionTimeout,
          maxLoginAttempts: settings.maxLoginAttempts,
          passwordMinLength: settings.passwordMinLength,
          requirePasswordComplexity: settings.requirePasswordComplexity,
        };
      }
      
      // If no settings found, create default settings
      const defaultSettings = {
        siteName: "PUCUDA MFG Warehouse",
        companyName: "PUCUDA Manufacturing",
        contactEmail: "manufacturingpucuda@gmail.com",
        maintenanceMode: false,
        allowUserRegistration: false,
        requireEmailVerification: true,
        sessionTimeout: 60,
        maxLoginAttempts: 5,
        passwordMinLength: 8,
        requirePasswordComplexity: true,
      };
      
      await db.insert(systemSettings).values(defaultSettings);
      return defaultSettings;
    } catch (error) {
      console.error("Error fetching system settings:", error);
      // Fallback to default settings
      return {
        siteName: "PUCUDA MFG Warehouse",
        companyName: "PUCUDA Manufacturing",
        contactEmail: "manufacturingpucuda@gmail.com",
        maintenanceMode: false,
        allowUserRegistration: false,
        requireEmailVerification: true,
        sessionTimeout: 60,
        maxLoginAttempts: 5,
        passwordMinLength: 8,
        requirePasswordComplexity: true,
      };
    }
  }

  async updateSystemSettings(settings: SystemSettings): Promise<SystemSettings> {
    try {
      // Check if settings exist
      const [existing] = await db.select().from(systemSettings).limit(1);
      
      if (existing) {
        // Update existing settings
        const [updated] = await db
          .update(systemSettings)
          .set({
            siteName: settings.siteName,
            companyName: settings.companyName,
            contactEmail: settings.contactEmail,
            maintenanceMode: settings.maintenanceMode,
            allowUserRegistration: settings.allowUserRegistration,
            requireEmailVerification: settings.requireEmailVerification,
            sessionTimeout: settings.sessionTimeout,
            maxLoginAttempts: settings.maxLoginAttempts,
            passwordMinLength: settings.passwordMinLength,
            requirePasswordComplexity: settings.requirePasswordComplexity,
            updatedAt: new Date(),
          })
          .where(eq(systemSettings.id, existing.id))
          .returning();
        
        return {
          siteName: updated.siteName,
          companyName: updated.companyName,
          contactEmail: updated.contactEmail,
          maintenanceMode: updated.maintenanceMode,
          allowUserRegistration: updated.allowUserRegistration,
          requireEmailVerification: updated.requireEmailVerification,
          sessionTimeout: updated.sessionTimeout,
          maxLoginAttempts: updated.maxLoginAttempts,
          passwordMinLength: updated.passwordMinLength,
          requirePasswordComplexity: updated.requirePasswordComplexity,
        };
      } else {
        // Insert new settings
        const [created] = await db
          .insert(systemSettings)
          .values(settings)
          .returning();
        
        return {
          siteName: created.siteName,
          companyName: created.companyName,
          contactEmail: created.contactEmail,
          maintenanceMode: created.maintenanceMode,
          allowUserRegistration: created.allowUserRegistration,
          requireEmailVerification: created.requireEmailVerification,
          sessionTimeout: created.sessionTimeout,
          maxLoginAttempts: created.maxLoginAttempts,
          passwordMinLength: created.passwordMinLength,
          requirePasswordComplexity: created.requirePasswordComplexity,
        };
      }
    } catch (error) {
      console.error("Error updating system settings:", error);
      throw new Error("Failed to update system settings");
    }
  }

  async verifyAndUpdatePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    try {
      // Verify current password
      const verifyQuery = `
        SELECT id FROM users 
        WHERE id = $1 AND password = $2 AND active = true
      `;
      
      const verifyResult = await pool.query(verifyQuery, [userId, currentPassword]);
      
      if (verifyResult.rows.length === 0) {
        return false; // Current password is incorrect
      }
      
      // Update to new password
      const updateQuery = `
        UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `;
      
      await pool.query(updateQuery, [newPassword, userId]);
      return true;
    } catch (error) {
      console.error("Error updating password:", error);
      return false;
    }
  }

  // Shipment management methods
  private shipmentsStore: any[] = [
    {
      id: "1",
      shipmentNumber: "SH-2025-001",
      formType: "pallet",
      salesOrderNumber: "SO-2025-001",
      customerName: "ABC Manufacturing",
      palletBoxItems: [
        { qty: 2, length: 48, width: 40, height: 42, weight: 1500 }
      ],
      totalQty: 2,
      totalWeight: 1500,
      notes: "Handle with care - fragile items",
      completedBy: "John Smith",
      completedDate: "2025-01-15",
      supervisor: "Jane Doe",
      status: "pending",
      createdAt: new Date(),
    },
    {
      id: "2",
      shipmentNumber: "SH-2025-002",
      formType: "pulllist",
      project: "Building Construction - Phase 1",
      company: "XYZ Construction Co.",
      pullListReceived: "yes",
      salesOrderNumber: "SO-2025-002",
      items: [
        { qtyOrdered: 5, qtyShipped: 5, partNumber: "80R-900-103A", description: "3 Part Perimeter Arm (20') Incl Couplers", qtyReturned: 0 },
        { qtyOrdered: 113, qtyShipped: 110, partNumber: "80R-900-010", description: "10' Arm Section", qtyReturned: 3 }
      ],
      pulledBy: "Mike Johnson",
      pulledDate: "2025-01-16",
      supervisor: "Sarah Wilson",
      supervisorDate: "2025-01-16",
      status: "shipped",
      createdAt: new Date(),
    },
  ];

  async getShipments(): Promise<any[]> {
    try {
      return [...this.shipmentsStore];
    } catch (error) {
      console.error("Error fetching shipments:", error);
      throw new Error("Failed to fetch shipments");
    }
  }

  async getShipment(id: string): Promise<any | null> {
    try {
      return this.shipmentsStore.find(s => s.id === id) || null;
    } catch (error) {
      console.error("Error fetching shipment:", error);
      throw new Error("Failed to fetch shipment");
    }
  }

  async createShipment(shipmentData: any): Promise<any> {
    try {
      const shipmentNumber = `SH-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      
      const newShipment = {
        id: `${Date.now()}`,
        shipmentNumber,
        ...shipmentData,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Actually save to the in-memory store
      this.shipmentsStore.unshift(newShipment);
      
      return newShipment;
    } catch (error) {
      console.error("Error creating shipment:", error);
      throw new Error("Failed to create shipment");
    }
  }

  async updateShipment(id: string, updates: any): Promise<any | null> {
    try {
      const index = this.shipmentsStore.findIndex(s => s.id === id);
      if (index === -1) {
        return null;
      }
      
      this.shipmentsStore[index] = {
        ...this.shipmentsStore[index],
        ...updates,
        updatedAt: new Date()
      };
      
      return this.shipmentsStore[index];
    } catch (error) {
      console.error("Error updating shipment:", error);
      throw new Error("Failed to update shipment");
    }
  }

  async deleteShipment(id: string): Promise<boolean> {
    try {
      const index = this.shipmentsStore.findIndex(s => s.id === id);
      if (index === -1) {
        return false;
      }
      
      this.shipmentsStore.splice(index, 1);
      return true;
    } catch (error) {
      console.error("Error deleting shipment:", error);
      throw new Error("Failed to delete shipment");
    }
  }

  // Order Activities
  async createOrderActivity(activity: InsertOrderActivity): Promise<OrderActivity> {
    const [newActivity] = await db
      .insert(orderActivities)
      .values(activity)
      .returning();
    return newActivity;
  }

  async getOrderActivities(orderId: string): Promise<(OrderActivity & { user: { firstName: string; lastName: string; username: string } })[]> {
    const activities = await db
      .select({
        id: orderActivities.id,
        orderId: orderActivities.orderId,
        userId: orderActivities.userId,
        activityType: orderActivities.activityType,
        description: orderActivities.description,
        metadata: orderActivities.metadata,
        createdAt: orderActivities.createdAt,
        user: {
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
        },
      })
      .from(orderActivities)
      .innerJoin(users, eq(orderActivities.userId, users.id))
      .where(eq(orderActivities.orderId, orderId))
      .orderBy(desc(orderActivities.createdAt));
    
    return activities.filter(activity => activity.user.firstName !== null);
  }

  // Receiving Orders
  async getReceivingOrders(): Promise<ReceivingOrder[]> {
    try {
      const result = await db.select().from(receivingOrders).orderBy(desc(receivingOrders.createdAt));
      return result;
    } catch (error) {
      console.error("Error fetching receiving orders:", error);
      throw new Error("Failed to fetch receiving orders");
    }
  }

  async getReceivingOrder(id: string): Promise<ReceivingOrder | undefined> {
    try {
      const [order] = await db.select().from(receivingOrders).where(eq(receivingOrders.id, id));
      return order || undefined;
    } catch (error) {
      console.error("Error fetching receiving order:", error);
      throw new Error("Failed to fetch receiving order");
    }
  }

  async createReceivingOrder(orderData: InsertReceivingOrder): Promise<ReceivingOrder> {
    try {
      const [order] = await db
        .insert(receivingOrders)
        .values(orderData)
        .returning();
      return order;
    } catch (error) {
      console.error("Error creating receiving order:", error);
      throw new Error("Failed to create receiving order");
    }
  }

  async updateReceivingOrder(id: string, updates: Partial<ReceivingOrder>): Promise<ReceivingOrder | undefined> {
    try {
      const [order] = await db
        .update(receivingOrders)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(receivingOrders.id, id))
        .returning();
      return order || undefined;
    } catch (error) {
      console.error("Error updating receiving order:", error);
      throw new Error("Failed to update receiving order");
    }
  }

  async deleteReceivingOrder(id: string): Promise<boolean> {
    try {
      const result = await db.delete(receivingOrders).where(eq(receivingOrders.id, id));
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error("Error deleting receiving order:", error);
      throw new Error("Failed to delete receiving order");
    }
  }

  async receiveItem(orderId: string, itemData: { itemId: string; receivedQuantity: number; condition: string; lotNumber?: string; notes?: string }): Promise<ReceivingItem | undefined> {
    try {
      const [receivingItem] = await db
        .insert(receivingItems)
        .values({
          receivingOrderId: orderId,
          itemId: itemData.itemId,
          expectedQuantity: itemData.receivedQuantity, // For now, assume expected = received
          receivedQuantity: itemData.receivedQuantity,
          condition: itemData.condition as "good" | "damaged" | "defective",
          lotNumber: itemData.lotNumber,
          notes: itemData.notes,
        })
        .returning();
      return receivingItem || undefined;
    } catch (error) {
      console.error("Error receiving item:", error);
      throw new Error("Failed to receive item");
    }
  }

  // Activity logging
  async createActivity(activity: { userId: string; activityType: string; description: string; tableName: string; recordId: string; metadata?: any }): Promise<void> {
    try {
      // For now, just log to console since we don't have a generic activities table
      console.log("Activity logged:", activity);
    } catch (error) {
      console.error("Error creating activity:", error);
    }
  }

  // Clock System Implementation
  async getClockEmployees(): Promise<ClockEmployee[]> {
    return await db.select().from(clockEmployees);
  }

  async getClockEmployee(id: string): Promise<ClockEmployee | undefined> {
    const [employee] = await db.select().from(clockEmployees).where(eq(clockEmployees.id, id));
    return employee || undefined;
  }

  async createClockEmployee(employee: InsertClockEmployee): Promise<ClockEmployee> {
    const [newEmployee] = await db
      .insert(clockEmployees)
      .values(employee)
      .returning();
    return newEmployee;
  }

  async updateClockEmployee(id: string, updates: Partial<ClockEmployee>): Promise<ClockEmployee | undefined> {
    const [employee] = await db
      .update(clockEmployees)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(clockEmployees.id, id))
      .returning();
    return employee || undefined;
  }

  async deleteClockEmployee(id: string): Promise<boolean> {
    const result = await db.delete(clockEmployees).where(eq(clockEmployees.id, id));
    return (result.rowCount || 0) > 0;
  }

  async clockAction(employeeId: string): Promise<{ employee: ClockEmployee; status: string; log: ClockLog }> {
    const employee = await this.getClockEmployee(employeeId);
    if (!employee) {
      throw new Error("Employee not found");
    }

    let newStatus: string;
    let logType: string;
    let statusMessage: string;

    // State machine logic
    switch (employee.status) {
      case 'inactive':
        newStatus = 'working';
        logType = 'clock-in';
        statusMessage = 'Clocked In';
        break;
      case 'working':
        // Check if last log was lunch-in to determine next action
        const logs = await this.getClockLogs(employeeId);
        const lastLog = logs.filter(log => log.employeeId === employeeId)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        
        if (lastLog && lastLog.type === 'lunch-in') {
          newStatus = 'inactive';
          logType = 'clock-out';
          statusMessage = 'Clocked Out';
        } else {
          newStatus = 'on-lunch';
          logType = 'lunch-out';
          statusMessage = 'Started Lunch';
        }
        break;
      case 'on-lunch':
        newStatus = 'working';
        logType = 'lunch-in';
        statusMessage = 'Ended Lunch';
        break;
      default:
        throw new Error("Invalid employee status");
    }

    // Update employee status
    const updatedEmployee = await this.updateClockEmployee(employeeId, { status: newStatus as any });
    if (!updatedEmployee) {
      throw new Error("Failed to update employee status");
    }

    // Create log entry
    const [log] = await db
      .insert(clockLogs)
      .values({
        employeeId,
        type: logType as any,
        timestamp: Date.now(),
      })
      .returning();

    return {
      employee: updatedEmployee,
      status: statusMessage,
      log
    };
  }

  async getClockLogs(employeeId?: string): Promise<ClockLog[]> {
    if (employeeId) {
      return await db.select().from(clockLogs)
        .where(eq(clockLogs.employeeId, employeeId))
        .orderBy(desc(clockLogs.timestamp));
    }
    return await db.select().from(clockLogs).orderBy(desc(clockLogs.timestamp));
  }

  async getEmployeeTimeCard(employeeId: string, startDate: Date, endDate: Date): Promise<any> {
    const employee = await this.getClockEmployee(employeeId);
    if (!employee) {
      throw new Error("Employee not found");
    }

    const logs = await db.select().from(clockLogs)
      .where(
        and(
          eq(clockLogs.employeeId, employeeId),
          sql`${clockLogs.timestamp} >= ${startDate.getTime()}`,
          sql`${clockLogs.timestamp} <= ${endDate.getTime()}`
        )
      )
      .orderBy(clockLogs.timestamp);

    // Calculate daily totals
    const dailyReport: any = {};
    let totalWorkingTime = 0;

    logs.forEach(log => {
      const date = new Date(log.timestamp).toISOString().split('T')[0];
      if (!dailyReport[date]) {
        dailyReport[date] = { logs: [], workingTime: 0, lunchTime: 0 };
      }
      dailyReport[date].logs.push(log);
    });

    // Process each day's logs to calculate times
    Object.keys(dailyReport).forEach(date => {
      const dayLogs = dailyReport[date].logs;
      let workingTime = 0;
      let lunchTime = 0;
      let clockInTime = null;
      let lunchOutTime = null;

      for (const log of dayLogs) {
        switch (log.type) {
          case 'clock-in':
            clockInTime = log.timestamp;
            break;
          case 'lunch-out':
            if (clockInTime) {
              workingTime += (log.timestamp - clockInTime);
              lunchOutTime = log.timestamp;
            }
            break;
          case 'lunch-in':
            if (lunchOutTime) {
              lunchTime += (log.timestamp - lunchOutTime);
              clockInTime = log.timestamp;
            }
            break;
          case 'clock-out':
            if (clockInTime) {
              workingTime += (log.timestamp - clockInTime);
            }
            break;
        }
      }

      dailyReport[date].workingTime = workingTime;
      dailyReport[date].lunchTime = lunchTime;
      totalWorkingTime += workingTime;
    });

    const totalPay = (totalWorkingTime / (1000 * 60 * 60)) * parseFloat(employee.payRate);

    return {
      employee,
      dailyReport,
      totalWorkingTime,
      totalPay: totalPay.toFixed(2),
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    };
  }

  async exportAllHours(startDate: Date, endDate: Date): Promise<any> {
    const employees = await this.getClockEmployees();
    const exportData = [];

    for (const employee of employees) {
      const timeCard = await this.getEmployeeTimeCard(employee.id, startDate, endDate);
      exportData.push({
        employeeId: employee.id,
        employeeName: employee.name,
        payRate: employee.payRate,
        totalHours: (timeCard.totalWorkingTime / (1000 * 60 * 60)).toFixed(2),
        totalPay: timeCard.totalPay,
        dailyBreakdown: timeCard.dailyReport
      });
    }

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      employees: exportData
    };
  }

  // Work Orders
  async getWorkOrders(): Promise<WorkOrder[]> {
    return await db.select().from(workOrders).orderBy(desc(workOrders.createdAt));
  }

  async getWorkOrder(id: string): Promise<WorkOrder | undefined> {
    const [workOrder] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    return workOrder;
  }

  async createWorkOrder(workOrderData: InsertWorkOrder): Promise<WorkOrder> {
    const [workOrder] = await db
      .insert(workOrders)
      .values({
        ...workOrderData,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return workOrder;
  }

  async updateWorkOrder(id: string, updates: Partial<WorkOrder>): Promise<WorkOrder | undefined> {
    const [workOrder] = await db
      .update(workOrders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(workOrders.id, id))
      .returning();
    return workOrder;
  }

  async deleteWorkOrder(id: string): Promise<boolean> {
    const result = await db.delete(workOrders).where(eq(workOrders.id, id));
    return result.rowCount > 0;
  }
}

export const storage = new DatabaseStorage();
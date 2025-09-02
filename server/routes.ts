import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertItemSchema, insertOrderSchema, insertOrderActivitySchema, updateOrderSchema, checkoutSchema, checkoutItemSchema, checkinSchema, loginSchema, systemSettingsSchema, createUserSchema, updateUserSchema, insertReceivingOrderSchema, insertClockEmployeeSchema, insertWorkOrderSchema } from "@shared/schema";
import { z } from "zod";

// Password change schema
const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});
import session from "express-session";

// Authentication middleware
interface AuthenticatedRequest extends Request {
  user?: any;
}

const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.session || !(req.session as any).user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  req.user = (req.session as any).user;
  next();
};

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Authentication routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { employeeBarcode } = loginSchema.parse(req.body);
      const user = await storage.authenticateUser(employeeBarcode);
      
      if (!user) {
        return res.status(401).json({ message: "Invalid employee barcode" });
      }
      
      // Store user in session
      (req.session as any).user = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        role: user.role
      };
      
      res.json({ 
        message: "Login successful",
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          role: user.role
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session?.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  app.get("/api/auth/me", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Fetch full user data from storage
      const fullUser = await storage.getUser(req.user.id);
      if (!fullUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Return user data in expected format
      res.json({
        id: fullUser.id,
        name: `${fullUser.firstName} ${fullUser.lastName}`.trim(),
        employeeBarcode: fullUser.username,
        role: req.user.role,
        firstName: fullUser.firstName,
        lastName: fullUser.lastName
      });
    } catch (error) {
      console.error("Error fetching user data:", error);
      res.status(500).json({ message: "Failed to fetch user data" });
    }
  });

  app.post("/api/auth/change-password", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      
      // Verify current password
      const success = await storage.verifyAndUpdatePassword(req.user.id, currentPassword, newPassword);
      if (!success) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }
      
      res.json({ message: "Password changed successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // Settings routes
  app.get("/api/settings", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const settings = await storage.getSystemSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Only admins can update system settings
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const settingsData = systemSettingsSchema.parse(req.body);
      const updatedSettings = await storage.updateSystemSettings(settingsData);
      res.json(updatedSettings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      console.error("Error updating settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // User management routes - All protected
  app.get("/api/users", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Only admins can view all users
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const users = await storage.getUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/users", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      
      // Only admins can create users
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const validatedData = createUserSchema.extend({
        password: z.string().optional(),
        email: z.string().email().optional()
      }).parse(req.body);
      
      // Check if username already exists
      const existingUser = await storage.getUserByBarcode(validatedData.username);
      if (existingUser) {
        return res.status(409).json({ message: "Username already exists" });
      }

      // Ensure password is provided
      const userDataWithPassword = {
        ...validatedData,
        password: validatedData.password || 'defaultpassword123'
      };
      
      const user = await storage.createUser(userDataWithPassword);
      res.status(201).json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.patch("/api/users/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Only admins can update users
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      // Allow password updates in user edit
      const updateSchema = z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        username: z.string().optional(),
        role: z.enum(['admin', 'manager', 'worker']).optional(),
        email: z.string().email().optional(),
        password: z.string().min(6).optional()
      });
      
      const updates = updateSchema.parse(req.body);
      const user = await storage.updateUser(req.params.id, updates);
      if (!user) {
        return res.status(400).json({ message: "Unable to update user" });
      }
      res.json(user);
    } catch (error) {
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Only admins can delete users
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const success = await storage.deleteUser(req.params.id);
      if (!success) {
        return res.status(400).json({ message: "Unable to delete user" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Receiving Orders routes - All protected
  app.get("/api/receiving-orders", requireAuth, async (req, res) => {
    try {
      const orders = await storage.getReceivingOrders();
      res.json(orders);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch receiving orders" });
    }
  });

  app.get("/api/receiving-orders/:id", requireAuth, async (req, res) => {
    try {
      const order = await storage.getReceivingOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Receiving order not found" });
      }
      res.json(order);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch receiving order" });
    }
  });

  app.post("/api/receiving-orders", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertReceivingOrderSchema.parse(req.body);
      const order = await storage.createReceivingOrder(validatedData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        activityType: "created",
        description: `Created receiving order ${order.poNumber}`,
        tableName: "receiving_orders",
        recordId: order.id,
        metadata: { poNumber: order.poNumber, supplier: order.supplierName }
      });
      
      res.status(201).json(order);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create receiving order" });
    }
  });

  app.patch("/api/receiving-orders/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const updates = req.body;
      const order = await storage.updateReceivingOrder(req.params.id, updates);
      if (!order) {
        return res.status(404).json({ message: "Receiving order not found" });
      }
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        activityType: "updated",
        description: `Updated receiving order ${order.poNumber}`,
        tableName: "receiving_orders", 
        recordId: order.id,
        metadata: { poNumber: order.poNumber, changes: Object.keys(updates) }
      });
      
      res.json(order);
    } catch (error) {
      res.status(500).json({ message: "Failed to update receiving order" });
    }
  });

  app.delete("/api/receiving-orders/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const order = await storage.getReceivingOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Receiving order not found" });
      }
      
      const success = await storage.deleteReceivingOrder(req.params.id);
      if (!success) {
        return res.status(400).json({ message: "Unable to delete receiving order" });
      }
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        activityType: "deleted",
        description: `Deleted receiving order ${order.poNumber}`,
        tableName: "receiving_orders",
        recordId: order.id,
        metadata: { poNumber: order.poNumber, supplier: order.supplierName }
      });
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete receiving order" });
    }
  });

  app.post("/api/receiving-orders/:id/receive-item", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { itemId, receivedQuantity, condition, lotNumber, notes } = req.body;
      
      const result = await storage.receiveItem(req.params.id, {
        itemId,
        receivedQuantity,
        condition,
        lotNumber,
        notes
      });
      
      if (!result) {
        return res.status(400).json({ message: "Failed to receive item" });
      }
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        activityType: "received",
        description: `Received ${receivedQuantity} units of item ${itemId}`,
        tableName: "receiving_items",
        recordId: result.id,
        metadata: { receivedQuantity, condition, lotNumber }
      });
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to receive item" });
    }
  });
  
  // Items routes - All protected
  app.get("/api/items", requireAuth, async (req, res) => {
    try {
      const items = await storage.getItems();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch items" });
    }
  });

  app.get("/api/items/:id", requireAuth, async (req, res) => {
    try {
      const item = await storage.getItem(req.params.id);
      if (!item) {
        return res.status(400).json({ message: "Unable to find item" });
      }
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch item" });
    }
  });

  app.post("/api/items", requireAuth, async (req, res) => {
    try {
      const validatedData = insertItemSchema.parse(req.body);
      
      // Check if SKU already exists
      const existingItem = await storage.getItemBySku(validatedData.sku);
      if (existingItem) {
        return res.status(409).json({ message: "SKU already exists" });
      }
      
      const item = await storage.createItem(validatedData);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create item" });
    }
  });

  app.patch("/api/items/:id", requireAuth, async (req, res) => {
    try {
      const updates = req.body;
      const item = await storage.updateItem(req.params.id, updates);
      if (!item) {
        return res.status(400).json({ message: "Unable to update item" });
      }
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to update item" });
    }
  });

  app.delete("/api/items/:id", requireAuth, async (req, res) => {
    try {
      const success = await storage.deleteItem(req.params.id);
      if (!success) {
        return res.status(400).json({ message: "Unable to delete item" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete item" });
    }
  });

  // Orders routes - All protected
  app.get("/api/orders", requireAuth, async (req, res) => {
    try {
      const orders = await storage.getOrders();
      res.json(orders);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const order = await storage.getOrder(req.params.id);
      if (!order) {
        return res.status(400).json({ message: "Unable to find order" });
      }
      res.json(order);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch order" });
    }
  });

  app.post("/api/orders", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertOrderSchema.parse(req.body);
      const order = await storage.createOrder(validatedData);
      
      // Log order creation activity
      await storage.createOrderActivity({
        orderId: order.id,
        userId: req.user.id,
        activityType: "created",
        description: `Order ${order.orderNumber} created for customer: ${order.customer}`,
        metadata: { customer: order.customer, priority: order.priority }
      });
      
      res.status(201).json(order);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create order" });
    }
  });

  app.patch("/api/orders/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const updates = req.body;
      const originalOrder = await storage.getOrder(req.params.id);
      const order = await storage.updateOrder(req.params.id, updates);
      if (!order) {
        return res.status(400).json({ message: "Unable to find order" });
      }
      
      // Log activity based on what was updated
      let description = "";
      if (updates.status && updates.status !== originalOrder?.status) {
        description = `Order status changed from ${originalOrder?.status} to ${updates.status}`;
        await storage.createOrderActivity({
          orderId: order.id,
          userId: req.user.id,
          activityType: "status_changed",
          description,
          metadata: { oldStatus: originalOrder?.status, newStatus: updates.status }
        });
      }
      if (updates.priority && updates.priority !== originalOrder?.priority) {
        description = `Order priority changed from ${originalOrder?.priority} to ${updates.priority}`;
        await storage.createOrderActivity({
          orderId: order.id,
          userId: req.user.id,
          activityType: "priority_changed",
          description,
          metadata: { oldPriority: originalOrder?.priority, newPriority: updates.priority }
        });
      }
      if (updates.assignedTo && updates.assignedTo !== originalOrder?.assignedTo) {
        description = `Order assigned to ${updates.assignedTo}`;
        await storage.createOrderActivity({
          orderId: order.id,
          userId: req.user.id,
          activityType: "assigned",
          description,
          metadata: { assignedTo: updates.assignedTo }
        });
      }
      
      res.json(order);
    } catch (error) {
      res.status(500).json({ message: "Failed to update order" });
    }
  });

  app.delete("/api/orders/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const orderId = req.params.id;
      
      // Get order details for activity logging
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Log deletion activity before deleting
      await storage.createActivity({
        userId: req.user.id,
        activityType: "deleted",
        description: `Deleted order ${order.orderNumber}`,
        tableName: "orders",
        recordId: orderId,
        metadata: { orderNumber: order.orderNumber, customer: order.customer }
      });
      
      const success = await storage.deleteOrder(orderId);
      if (!success) {
        return res.status(400).json({ message: "Unable to delete order" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error('Error in delete order route:', error);
      res.status(500).json({ message: "Failed to delete order", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post("/api/orders/:id/fulfill", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      // Update both status and fulfilledAt timestamp for order fulfillment
      const order = await storage.updateOrder(req.params.id, {
        status: "fulfilled" as const,
        fulfilledAt: new Date(),
      });
      if (!order) {
        return res.status(400).json({ message: "Unable to find order" });
      }
      
      // Log fulfillment activity
      await storage.createOrderActivity({
        orderId: order.id,
        userId: req.user.id,
        activityType: "fulfilled",
        description: `Order ${order.orderNumber} marked as fulfilled`,
        metadata: { fulfilledAt: new Date() }
      });
      
      res.json(order);
    } catch (error) {
      res.status(500).json({ message: "Failed to fulfill order" });
    }
  });

  // Checkout route - Protected
  app.post("/api/checkout", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = checkoutSchema.parse(req.body);
      
      let order;
      if (validatedData.orderId) {
        // Add to existing order
        order = await storage.getOrder(validatedData.orderId);
        if (!order) {
          return res.status(400).json({ message: "Unable to find order" });
        }
      } else {
        // Create new order
        const orderNumber = `ORD-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
        order = await storage.createOrder({
          orderNumber,
          customer: validatedData.customer || "Unknown Customer",
          priority: validatedData.priority,
          notes: validatedData.notes || "",
        });
      }

      // Validate item availability and add to order
      for (const checkoutItem of validatedData.items) {
        const item = await storage.getItem(checkoutItem.itemId);
        if (!item) {
          return res.status(400).json({ message: `Item unavailable: ${checkoutItem.itemId}` });
        }
        
        const availableStock = item.currentStock - item.reservedStock;
        if (availableStock < checkoutItem.quantity) {
          return res.status(400).json({ 
            message: `Insufficient stock for ${item.sku}. Available: ${availableStock}, Requested: ${checkoutItem.quantity}` 
          });
        }

        await storage.addOrderItem({
          orderId: order.id,
          itemId: checkoutItem.itemId,
          quantity: checkoutItem.quantity,
        });

        // Log item addition activity
        await storage.createOrderActivity({
          orderId: order.id,
          userId: req.user.id,
          activityType: "item_added",
          description: `Added ${checkoutItem.quantity}x ${item.sku} (${item.productName}) to order`,
          metadata: { 
            itemId: checkoutItem.itemId, 
            sku: item.sku, 
            productName: item.productName, 
            quantity: checkoutItem.quantity 
          }
        });

        // Record the checkout transaction
        await storage.createItemTransaction({
          itemId: checkoutItem.itemId,
          orderId: order.id,
          userId: req.user.id,
          transactionType: "check-out",
          quantity: checkoutItem.quantity,
          notes: validatedData.notes,
        });
      }

      const updatedOrder = await storage.getOrder(order.id);
      res.status(201).json(updatedOrder);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid checkout data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to process checkout" });
    }
  });

  // Quick checkout route for individual items - Protected
  app.post("/api/items/:id/checkout", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const checkoutData = checkoutItemSchema.parse(req.body);
      const { 
        quantity, 
        orderId, 
        reasonCode, 
        condition, 
        location, 
        workOrder, 
        department, 
        urgency, 
        estimatedReturnDate, 
        approvedBy, 
        batchNumber, 
        serialNumbers, 
        notes 
      } = checkoutData;
      
      const item = await storage.getItem(req.params.id);
      if (!item) {
        return res.status(400).json({ message: "Unable to find item" });
      }

      let order;
      if (orderId) {
        order = await storage.getOrder(orderId);
        if (!order) {
          return res.status(400).json({ message: "Unable to find order" });
        }
      } else {
        // Create a quick checkout order
        const orderNumber = `CHK-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
        order = await storage.createOrder({
          orderNumber,
          customer: "Quick Checkout",
          priority: "standard",
          notes: `Quick checkout for ${item.sku}`,
        });
      }

      // Check availability
      const availableStock = item.currentStock - item.reservedStock;
      if (availableStock < quantity) {
        return res.status(400).json({ 
          message: `Insufficient stock for ${item.sku}. Available: ${availableStock}, Requested: ${quantity}` 
        });
      }

      // Add to order and update stock
      await storage.addOrderItem({
        orderId: order.id,
        itemId: item.id,
        quantity,
      });

      // Log item addition activity
      await storage.createOrderActivity({
        orderId: order.id,
        userId: req.user.id,
        activityType: "item_added",
        description: `Quick checkout: Added ${quantity}x ${item.sku} (${item.productName}) to order`,
        metadata: { 
          itemId: item.id, 
          sku: item.sku, 
          productName: item.productName, 
          quantity,
          checkoutType: "quick"
        }
      });

      // Record the enhanced checkout transaction
      await storage.createItemTransaction({
        itemId: item.id,
        orderId: order.id,
        userId: req.user.id,
        transactionType: "check-out",
        quantity,
        notes: notes || `Quick checkout for ${item.sku}`,
        reasonCode,
        condition: condition || "good",
        location,
        workOrder,
        department,
        urgency: urgency || "normal",
        estimatedReturnDate,
        approvedBy,
        batchNumber,
        serialNumbers,
      });

      // Update item status to checked-out if fully allocated
      const updatedItem = await storage.getItem(item.id);
      if (updatedItem && updatedItem.currentStock - updatedItem.reservedStock === 0) {
        await storage.updateItem(item.id, { status: "checked-out" });
      }

      const updatedOrder = await storage.getOrder(order.id);
      res.status(201).json(updatedOrder);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid checkout data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to process checkout" });
    }
  });

  // Order Activities routes
  app.get("/api/orders/:id/activities", requireAuth, async (req, res) => {
    try {
      const activities = await storage.getOrderActivities(req.params.id);
      res.json(activities);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch order activities" });
    }
  });

  app.post("/api/orders/:id/activities", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertOrderActivitySchema.parse(req.body);
      const activity = await storage.createOrderActivity({
        ...validatedData,
        orderId: req.params.id,
        userId: req.user.id,
      });
      res.status(201).json(activity);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create activity" });
    }
  });

  // Check-in item route - Protected
  app.post("/api/items/:id/checkin", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const checkinData = checkinSchema.parse(req.body);
      const { 
        quantity, 
        notes, 
        reasonCode, 
        condition, 
        location, 
        workOrder, 
        department, 
        batchNumber, 
        serialNumbers, 
        actualReturnDate 
      } = checkinData;
      
      const item = await storage.getItem(req.params.id);
      if (!item) {
        return res.status(400).json({ message: "Unable to find item" });
      }

      // Check if there's enough reserved stock to check in
      if (item.reservedStock < quantity) {
        return res.status(400).json({ 
          message: `Cannot check in ${quantity} ${item.unitType}. Only ${item.reservedStock} are currently checked out.` 
        });
      }

      // Pass enhanced data to storage
      const enhancedData = {
        reasonCode,
        condition,
        location,
        workOrder,
        department,
        batchNumber,
        serialNumbers,
        actualReturnDate
      };

      await storage.checkInItem(req.params.id, quantity, req.user.id, notes, enhancedData);

      const updatedItem = await storage.getItem(req.params.id);
      res.json(updatedItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid check-in data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to check in item" });
    }
  });

  // Get item transaction history - Protected
  app.get("/api/transactions", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { itemId } = req.query;
      const transactions = await storage.getItemTransactions(itemId as string);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: "Failed to get transaction history" });
    }
  });

  // Get enhanced transaction history with comprehensive data - Protected
  app.get("/api/transactions/enhanced", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { itemId, userId, department, urgency, reasonCode, dateFrom, dateTo } = req.query;
      const transactions = await storage.getEnhancedTransactions({
        itemId: itemId as string,
        userId: userId as string,
        department: department as string,
        urgency: urgency as string,
        reasonCode: reasonCode as string,
        dateFrom: dateFrom ? new Date(dateFrom as string) : undefined,
        dateTo: dateTo ? new Date(dateTo as string) : undefined,
      });
      res.json(transactions);
    } catch (error) {
      console.error("Enhanced transactions error:", error);
      res.status(500).json({ message: "Failed to get enhanced transaction history" });
    }
  });

  // Shipments routes - All protected
  app.get("/api/shipments", requireAuth, async (req, res) => {
    try {
      const shipments = await storage.getShipments();
      res.json(shipments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch shipments" });
    }
  });

  app.get("/api/shipments/:id", requireAuth, async (req, res) => {
    try {
      const shipment = await storage.getShipment(req.params.id);
      if (!shipment) {
        return res.status(404).json({ message: "Shipment not found" });
      }
      res.json(shipment);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch shipment" });
    }
  });

  app.post("/api/shipments", requireAuth, async (req, res) => {
    try {
      const shipment = await storage.createShipment(req.body);
      res.status(201).json(shipment);
    } catch (error) {
      res.status(500).json({ message: "Failed to create shipment" });
    }
  });

  app.patch("/api/shipments/:id", requireAuth, async (req, res) => {
    try {
      const shipment = await storage.updateShipment(req.params.id, req.body);
      if (!shipment) {
        return res.status(404).json({ message: "Shipment not found" });
      }
      res.json(shipment);
    } catch (error) {
      res.status(500).json({ message: "Failed to update shipment" });
    }
  });

  app.delete("/api/shipments/:id", requireAuth, async (req, res) => {
    try {
      const success = await storage.deleteShipment(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Shipment not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete shipment" });
    }
  });

  // Clock System Routes
  app.get("/api/clock/employees", requireAuth, async (req, res) => {
    try {
      const employees = await storage.getClockEmployees();
      res.json(employees);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employees" });
    }
  });

  app.get("/api/clock/logs", requireAuth, async (req, res) => {
    try {
      const employeeId = req.query.employeeId as string;
      const logs = await storage.getClockLogs(employeeId);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch clock logs" });
    }
  });

  app.post("/api/clock/employees", requireAuth, async (req, res) => {
    try {
      const data = insertClockEmployeeSchema.parse(req.body);
      const employee = await storage.createClockEmployee(data);
      res.status(201).json(employee);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create employee" });
    }
  });

  app.patch("/api/clock/employees/:id", requireAuth, async (req, res) => {
    try {
      const employee = await storage.updateClockEmployee(req.params.id, req.body);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }
      res.json(employee);
    } catch (error) {
      res.status(500).json({ message: "Failed to update employee" });
    }
  });

  app.delete("/api/clock/employees/:id", requireAuth, async (req, res) => {
    try {
      const success = await storage.deleteClockEmployee(req.params.id);
      if (!success) {
        return res.status(404).json({ message: "Employee not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employee" });
    }
  });

  app.post("/api/clock/action", requireAuth, async (req, res) => {
    try {
      const { employeeId } = req.body;
      if (!employeeId) {
        return res.status(400).json({ message: "Employee ID is required" });
      }
      
      const result = await storage.clockAction(employeeId);
      res.json(result);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to process clock action" });
    }
  });

  app.get("/api/clock/timecard/:employeeId", requireAuth, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "Start date and end date are required" });
      }
      
      const timeCard = await storage.getEmployeeTimeCard(
        employeeId,
        new Date(startDate as string),
        new Date(endDate as string)
      );
      res.json(timeCard);
    } catch (error) {
      if (error instanceof Error) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to fetch time card" });
    }
  });

  app.get("/api/clock/export", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "Start date and end date are required" });
      }
      
      const exportData = await storage.exportAllHours(
        new Date(startDate as string),
        new Date(endDate as string)
      );
      res.json(exportData);
    } catch (error) {
      res.status(500).json({ message: "Failed to export hours" });
    }
  });

  // Work Orders routes - Protected
  app.get("/api/work-orders", requireAuth, async (req, res) => {
    try {
      const workOrders = await storage.getWorkOrders();
      res.json(workOrders);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch work orders" });
    }
  });

  app.get("/api/work-orders/:id", requireAuth, async (req, res) => {
    try {
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      res.json(workOrder);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch work order" });
    }
  });

  app.post("/api/work-orders", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const validatedData = insertWorkOrderSchema.parse(req.body);
      const workOrder = await storage.createWorkOrder(validatedData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        activityType: "created",
        description: `Created work order "${workOrder.title}"`,
        tableName: "work_orders",
        recordId: workOrder.id,
        metadata: { title: workOrder.title, category: workOrder.category, priority: workOrder.priority }
      });
      
      res.status(201).json(workOrder);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create work order" });
    }
  });

  app.patch("/api/work-orders/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const workOrder = await storage.updateWorkOrder(req.params.id, req.body);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        activityType: "updated",
        description: `Updated work order "${workOrder.title}"`,
        tableName: "work_orders",
        recordId: workOrder.id,
        metadata: { title: workOrder.title, status: workOrder.status }
      });
      
      res.json(workOrder);
    } catch (error) {
      res.status(500).json({ message: "Failed to update work order" });
    }
  });

  app.delete("/api/work-orders/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder) {
        return res.status(404).json({ message: "Work order not found" });
      }
      
      const deleted = await storage.deleteWorkOrder(req.params.id);
      if (!deleted) {
        return res.status(400).json({ message: "Unable to delete work order" });
      }
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        activityType: "deleted",
        description: `Deleted work order "${workOrder.title}"`,
        tableName: "work_orders",
        recordId: workOrder.id,
        metadata: { title: workOrder.title }
      });
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete work order" });
    }
  });

  // Analytics route - Protected
  app.get("/api/analytics/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getInventoryStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

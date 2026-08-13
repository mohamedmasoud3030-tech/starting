import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { useAuth } from "./AuthContext";
import {
  initialSettings,
  initialCategories,
  initialProducts,
  initialTables,
  initialOrders
} from "../types/data";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { profile } = useAuth();

  const [settings, setSettings] = useState(initialSettings);
  const [categories, setCategories] = useState(initialCategories);
  const [products, setProducts] = useState(initialProducts);
  const [tables, setTables] = useState(initialTables);
  const [orders, setOrders] = useState(initialOrders);
  const [heldOrders, setHeldOrders] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase
        .from("restaurant_settings")
        .select("*")
        .eq("id", 1)
        .single();

      if (data && !error) {
        setSettings({
          restaurantName: data.restaurant_name,
          branchName: data.branch_name,
          phone: data.phone,
          address: data.address,
          taxNumber: data.tax_number,
          currency: data.currency,
          taxRate: Number(data.tax_rate),
          serviceFeeRate: 0,
          footerNote: data.receipt_footer,
          autoPrintKitchen: true,
          enableSound: true,
        });
      }
    } catch (err) {
      console.warn("Could not fetch settings from Supabase:", err);
    }
  }, []);

  const fetchMenuItems = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { data: catData } = await supabase
        .from("categories")
        .select("*")
        .order("sort_order", { ascending: true });

      if (catData && catData.length > 0) {
        const mappedCats = [
          { id: "all", name: "كل الأصناف", icon: "Utensils", count: 0 },
          ...catData.map((c) => ({
            id: c.id,
            name: c.name,
            icon: c.icon || "Utensils",
            count: 0
          }))
        ];
        setCategories(mappedCats);
      }

      const { data: itemsData, error } = await supabase
        .from("menu_items")
        .select(`
          *,
          modifiers (*)
        `)
        .order("sort_order", { ascending: true });

      if (itemsData && !error) {
        const mappedProducts = itemsData.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category_id || "burgers",
          price: Number(item.price),
          cost: Number(item.price) * 0.4,
          calories: item.is_spicy ? 650 : 580,
          image: item.image_url || "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80",
          badge: item.badge || (item.is_bestseller ? "الأكثر مبيعاً 🔥" : item.is_spicy ? "سبايسي 🌶️" : item.is_new ? "جديد ⚡" : ""),
          description: item.description || "",
          modifiers: item.modifiers ? [
            {
              id: "size",
              name: "خيارات إضافية",
              required: false,
              options: item.modifiers.map((m) => ({
                name: m.name,
                price: Number(m.price)
              }))
            }
          ] : []
        }));
        setProducts(mappedProducts);
      }
    } catch (err) {
      console.warn("Could not fetch menu from Supabase:", err);
    }
  }, []);

  const fetchTables = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase
        .from("tables")
        .select("*")
        .order("table_number", { ascending: true });

      if (data && !error && data.length > 0) {
        setTables(data.map((t) => ({
          id: t.id,
          name: `طاولة ${t.table_number}`,
          tableNumber: t.table_number,
          capacity: t.seats || 4,
          section: t.section === "family" ? "كبائن العائلات" : t.section === "terrace" ? "التراس الخارجي" : "الصالة الرئيسية",
          status: t.status,
          orderId: t.current_order_id,
          amount: 0,
          time: t.status === "occupied" ? "15 دقيقة" : ""
        })));
      }
    } catch (err) {
      console.warn("Could not fetch tables from Supabase:", err);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          *,
          order_items (*)
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (data && !error) {
        const mappedOrders = data.map((o) => ({
          id: o.id,
          orderNumber: o.order_number?.toString() || o.id.slice(0, 5),
          type: o.order_type,
          table: o.table_id ? `طاولة` : "-",
          customer: o.customer_name || "عميل",
          items: o.order_items ? o.order_items.map((it) => ({
            name: it.item_name,
            qty: it.quantity,
            price: Number(it.unit_price),
            selectedOptions: it.modifiers_applied || [],
            notes: it.notes || ""
          })) : [],
          subtotal: Number(o.subtotal),
          tax: Number(o.tax_amount),
          discount: Number(o.discount_amount),
          total: Number(o.total_amount),
          status: o.status === "pending" ? "in_kitchen" : o.status === "preparing" ? "cooking" : o.status,
          paymentMethod: o.payment_method || "cash",
          cashPaid: Number(o.cash_received || 0),
          changeDue: Number(o.cash_change || 0),
          createdAt: o.created_at,
          notes: o.notes || ""
        }));
        setOrders(mappedOrders);
      }
    } catch (err) {
      console.warn("Could not fetch orders from Supabase:", err);
    }
  }, []);

  const fetchHeldOrders = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase
        .from("held_orders")
        .select("*")
        .order("held_at", { ascending: false });

      if (data && !error) {
        setHeldOrders(data.map((h) => ({
          id: h.id,
          customerName: h.customer_name,
          timestamp: new Date(h.held_at).getTime(),
          ...h.order_data
        })));
      }
    } catch (err) {
      console.warn("Could not fetch held orders:", err);
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    if (!isSupabaseConfigured) {
      const raw = localStorage.getItem("pos_audit_logs");
      if (raw) setAuditLogs(JSON.parse(raw));
      return;
    }
    try {
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (data) {
        setAuditLogs(data.map((l) => ({
          id: l.id,
          timestamp: l.created_at,
          userId: l.user_id,
          username: l.username,
          role: l.role,
          action: l.action,
          details: typeof l.details === "object" ? JSON.stringify(l.details) : l.details
        })));
      }
    } catch (err) {}
  }, []);

  useEffect(() => {
    async function loadAllData() {
      setLoading(true);
      await Promise.all([
        fetchSettings(),
        fetchMenuItems(),
        fetchTables(),
        fetchOrders(),
        fetchHeldOrders(),
        fetchAuditLogs()
      ]);
      setLoading(false);
    }

    loadAllData();

    if (isSupabaseConfigured) {
      const ordersChannel = supabase
        .channel("realtime_orders")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
          fetchOrders();
        })
        .subscribe();

      const tablesChannel = supabase
        .channel("realtime_tables")
        .on("postgres_changes", { event: "*", schema: "public", table: "tables" }, () => {
          fetchTables();
        })
        .subscribe();

      const menuChannel = supabase
        .channel("realtime_menu")
        .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, () => {
          fetchMenuItems();
        })
        .subscribe();

      const heldChannel = supabase
        .channel("realtime_held")
        .on("postgres_changes", { event: "*", schema: "public", table: "held_orders" }, () => {
          fetchHeldOrders();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(ordersChannel);
        supabase.removeChannel(tablesChannel);
        supabase.removeChannel(menuChannel);
        supabase.removeChannel(heldChannel);
      };
    }
  }, [fetchSettings, fetchMenuItems, fetchTables, fetchOrders, fetchHeldOrders, fetchAuditLogs]);

  const createOrder = async (orderPayload) => {
    if (!isSupabaseConfigured) {
      setOrders((prev) => [orderPayload, ...prev]);
      return orderPayload;
    }

    try {
      const { data: orderData, error: orderErr } = await supabase
        .from("orders")
        .insert([{
          order_type: orderPayload.type,
          status: "pending",
          customer_name: orderPayload.customer,
          subtotal: orderPayload.subtotal,
          discount_amount: orderPayload.discount || 0,
          tax_amount: orderPayload.tax || 0,
          total_amount: orderPayload.total,
          payment_method: orderPayload.paymentMethod,
          payment_status: "paid",
          cash_received: orderPayload.cashPaid || orderPayload.total,
          cash_change: orderPayload.changeDue || 0,
          notes: orderPayload.notes,
          created_by: profile?.id
        }])
        .select()
        .single();

      if (orderErr) throw orderErr;

      if (orderData && orderPayload.items?.length > 0) {
        const itemsToInsert = orderPayload.items.map((it) => ({
          order_id: orderData.id,
          item_name: it.name,
          quantity: it.qty,
          unit_price: it.price,
          modifiers_applied: it.selectedOptions || [],
          notes: it.notes || ""
        }));

        await supabase.from("order_items").insert(itemsToInsert);
      }

      await fetchOrders();
      return orderData;
    } catch (err) {
      console.error("Error creating order:", err);
      setOrders((prev) => [orderPayload, ...prev]);
      return orderPayload;
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    const dbStatus = newStatus === "cooking" ? "preparing" : newStatus === "in_kitchen" ? "pending" : newStatus;

    if (isSupabaseConfigured) {
      try {
        await supabase
          .from("orders")
          .update({
            status: dbStatus,
            completed_at: newStatus === "completed" ? new Date().toISOString() : null,
            updated_at: new Date().toISOString()
          })
          .eq("id", orderId);
      } catch (err) {
        console.error("Failed to update status in Supabase:", err);
      }
    }

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
    );
  };

  const updateTableStatus = async (tableId, newStatus) => {
    if (isSupabaseConfigured) {
      try {
        await supabase
          .from("tables")
          .update({ status: newStatus })
          .eq("id", tableId);
      } catch (err) {}
    }
    setTables((prev) =>
      prev.map((t) => (t.id === tableId ? { ...t, status: newStatus } : t))
    );
  };

  const updateSettings = async (newSettings) => {
    setSettings(newSettings);
    if (isSupabaseConfigured) {
      try {
        await supabase
          .from("restaurant_settings")
          .update({
            restaurant_name: newSettings.restaurantName,
            branch_name: newSettings.branchName,
            phone: newSettings.phone,
            address: newSettings.address,
            tax_number: newSettings.taxNumber,
            currency: newSettings.currency,
            tax_rate: newSettings.taxRate,
            receipt_footer: newSettings.footerNote,
            updated_at: new Date().toISOString()
          })
          .eq("id", 1);
      } catch (err) {
        console.error("Error updating settings in Supabase:", err);
      }
    }
  };

  const logAuditAction = async (action, details) => {
    const logItem = {
      user_id: profile?.id || null,
      username: profile?.full_name || profile?.username || "مستخدم",
      role: profile?.role || "system",
      action,
      details: typeof details === "object" ? details : { message: details }
    };

    if (isSupabaseConfigured) {
      try {
        await supabase.from("audit_logs").insert([logItem]);
      } catch (e) {}
    }

    setAuditLogs((prev) => [
      {
        id: "log_" + Date.now(),
        timestamp: new Date().toISOString(),
        userId: logItem.user_id,
        username: logItem.username,
        role: logItem.role,
        action: logItem.action,
        details: typeof details === "object" ? JSON.stringify(details) : details
      },
      ...prev
    ]);
  };

  const holdOrder = async (orderData) => {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from("held_orders")
          .insert([{
            order_data: orderData,
            customer_name: orderData.customerName || "عميل",
            held_by: profile?.id
          }])
          .select()
          .single();

        if (error) throw error;
        await fetchHeldOrders();
        return data;
      } catch (err) {
        console.error("Error holding order in Supabase:", err);
      }
    }
    const localHeld = { id: "HOLD-" + Date.now(), ...orderData };
    setHeldOrders((prev) => [localHeld, ...prev]);
    return localHeld;
  };

  const resumeHeldOrder = async (heldOrderId) => {
    const found = heldOrders.find((h) => h.id === heldOrderId);
    if (isSupabaseConfigured) {
      try {
        await supabase.from("held_orders").delete().eq("id", heldOrderId);
        await fetchHeldOrders();
      } catch (err) {}
    }
    setHeldOrders((prev) => prev.filter((h) => h.id !== heldOrderId));
    return found;
  };

  const deleteHeldOrder = async (heldOrderId) => {
    if (isSupabaseConfigured) {
      try {
        await supabase.from("held_orders").delete().eq("id", heldOrderId);
      } catch (err) {}
    }
    setHeldOrders((prev) => prev.filter((h) => h.id !== heldOrderId));
  };

  const fetchDailyReport = useCallback(async (dateStr) => {
    const targetDate = dateStr || new Date().toISOString().split("T")[0];
    const filtered = orders.filter((o) => o.createdAt && o.createdAt.startsWith(targetDate));

    const totalSales = filtered.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const totalTax = filtered.reduce((sum, o) => sum + Number(o.tax || 0), 0);
    const totalDiscount = filtered.reduce((sum, o) => sum + Number(o.discount || 0), 0);
    const orderCount = filtered.length;

    return {
      date: targetDate,
      totalSales,
      totalTax,
      totalDiscount,
      orderCount,
      avgOrderValue: orderCount > 0 ? totalSales / orderCount : 0
    };
  }, [orders]);

  const fetchZReport = useCallback(async (dateStr) => {
    const targetDate = dateStr || new Date().toISOString().split("T")[0];
    const filtered = orders.filter((o) => o.createdAt && o.createdAt.startsWith(targetDate));

    const cashTotal = filtered.filter((o) => o.paymentMethod === "cash").reduce((s, o) => s + Number(o.total || 0), 0);
    const cardTotal = filtered.filter((o) => o.paymentMethod === "card" || o.paymentMethod === "mobile").reduce((s, o) => s + Number(o.total || 0), 0);
    const totalRevenue = cashTotal + cardTotal;
    const ordersCount = filtered.length;

    return {
      date: targetDate,
      cashTotal,
      cardTotal,
      totalRevenue,
      ordersCount,
      avgTicket: ordersCount > 0 ? totalRevenue / ordersCount : 0
    };
  }, [orders]);

  const fetchTopItems = useCallback((dateStr, limit = 5) => {
    const itemMap = {};
    orders.forEach((o) => {
      o.items?.forEach((it) => {
        if (!itemMap[it.name]) {
          itemMap[it.name] = { name: it.name, qty: 0, revenue: 0 };
        }
        itemMap[it.name].qty += it.qty;
        itemMap[it.name].revenue += it.price * it.qty;
      });
    });

    return Object.values(itemMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, limit);
  }, [orders]);

  return (
    <DataContext.Provider
      value={{
        settings,
        setSettings: updateSettings,
        categories,
        products,
        setProducts,
        tables,
        setTables,
        orders,
        setOrders,
        heldOrders,
        setHeldOrders,
        auditLogs,
        loading,
        createOrder,
        updateOrderStatus,
        updateTableStatus,
        holdOrder,
        resumeHeldOrder,
        deleteHeldOrder,
        fetchDailyReport,
        fetchZReport,
        fetchTopItems,
        fetchOrders,
        fetchMenuItems,
        fetchTables,
        fetchSettings,
        logAuditAction
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error("useData must be used within a DataProvider");
  }
  return context;
}

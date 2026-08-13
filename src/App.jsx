// src/App.jsx
// Main Application Coordinator powered by Supabase Auth & Data Contexts

import React, { useState, useEffect } from "react";
import confetti from "canvas-confetti";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { DataProvider, useData } from "./context/DataContext";
import Header from "./components/Header";
import POSView from "./components/POSView";
import KitchenDisplay from "./components/KitchenDisplay";
import TablesView from "./components/TablesView";
import ReportsView from "./components/ReportsView";
import SettingsView from "./components/SettingsView";
import LoginView from "./components/LoginView";
import PaymentModal from "./components/PaymentModal";
import ThermalReceipt from "./components/ThermalReceipt";
import HoldOrdersModal from "./components/HoldOrdersModal";
import { playSound } from "./utils/audio";

function MainApp() {
  const { user, profile, role, loading: authLoading, logout } = useAuth();
  const {
    settings,
    setSettings,
    products,
    setProducts,
    categories,
    tables,
    setTables,
    orders,
    heldOrders,
    setHeldOrders,
    auditLogs,
    createOrder,
    updateOrderStatus,
    updateTableStatus,
    logAuditAction
  } = useData();

  // Navigation State
  const [activeTab, setActiveTab] = useState("pos");

  // Cart & POS State
  const [cartItems, setCartItems] = useState([]);
  const [orderType, setOrderType] = useState("takeaway");
  const [selectedTable, setSelectedTable] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);

  // Audio state
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Modals State
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [activeReceiptOrder, setActiveReceiptOrder] = useState(null);
  const [isHeldModalOpen, setIsHeldModalOpen] = useState(false);

  // Route Guard by Role
  useEffect(() => {
    if (role === "kitchen" && activeTab !== "kitchen") {
      setActiveTab("kitchen");
    } else if (role === "cashier" && (activeTab === "reports" || activeTab === "settings")) {
      setActiveTab("pos");
    }
  }, [role, activeTab]);

  const triggerAudio = (type) => {
    if (soundEnabled) {
      playSound(type);
    }
  };

  // Cart Actions
  const handleAddToCart = (item) => {
    triggerAudio("add");
    setCartItems((prev) => {
      const existingIndex = prev.findIndex(
        (i) =>
          i.product.id === item.product.id &&
          JSON.stringify(i.selectedOptions) === JSON.stringify(item.selectedOptions) &&
          i.notes === item.notes
      );

      if (existingIndex > -1) {
        const updated = [...prev];
        updated[existingIndex].quantity += item.quantity;
        return updated;
      } else {
        return [...prev, item];
      }
    });

    logAuditAction("إضافة صنف للسلة", `إضافة ${item.product.name} (الكمية: ${item.quantity})`);
  };

  const handleUpdateQty = (index, newQty) => {
    const item = cartItems[index];
    if (newQty <= 0) {
      handleRemoveItem(index);
    } else {
      triggerAudio("beep");
      setCartItems((prev) => {
        const updated = [...prev];
        updated[index].quantity = newQty;
        return updated;
      });
      if (item) {
        logAuditAction("تعديل كمية", `تعديل كمية ${item.product.name} إلى ${newQty}`);
      }
    }
  };

  const handleRemoveItem = (index) => {
    const item = cartItems[index];
    triggerAudio("remove");
    setCartItems((prev) => prev.filter((_, i) => i !== index));
    if (item) {
      logAuditAction("حذف صنف", `حذف ${item.product.name} من السلة`);
    }
  };

  const handleClearCart = () => {
    if (cartItems.length > 0) {
      triggerAudio("remove");
      setCartItems([]);
      setDiscountPercent(0);
      setSelectedTable("");
      setCustomerName("");
      logAuditAction("إلغاء الطلب", "تم إفراغ السلة");
    }
  };

  // Hold / Resume Order
  const handleHoldOrder = () => {
    if (cartItems.length === 0) return;
    const holdId = "HOLD-" + Math.floor(100 + Math.random() * 900);
    const held = {
      id: holdId,
      cartItems,
      orderType,
      selectedTable,
      customerName,
      discountPercent,
      timestamp: Date.now()
    };
    setHeldOrders((prev) => [held, ...prev]);
    setCartItems([]);
    setDiscountPercent(0);
    setSelectedTable("");
    setCustomerName("");
    triggerAudio("beep");
    logAuditAction("تعليق طلب", `تعليق الطلب برقم: ${holdId}`);
  };

  const handleRecallOrder = (order) => {
    setCartItems(order.cartItems);
    setOrderType(order.orderType);
    setSelectedTable(order.selectedTable || "");
    setCustomerName(order.customerName || "");
    setDiscountPercent(order.discountPercent || 0);
    setHeldOrders((prev) => prev.filter((h) => h.id !== order.id));
    setIsHeldModalOpen(false);
    setActiveTab("pos");
    triggerAudio("beep");
    logAuditAction("استرجاع طلب معلق", `استرجاع الطلب المعلق: ${order.id}`);
  };

  const handleDeleteHeldOrder = (orderId) => {
    setHeldOrders((prev) => prev.filter((h) => h.id !== orderId));
    triggerAudio("remove");
    logAuditAction("حذف طلب معلق", `حذف الطلب المعلق: ${orderId}`);
  };

  // Table selection from Tables View
  const handleSelectTableForOrder = (table) => {
    setSelectedTable(table.name);
    setOrderType("dine_in");
    setActiveTab("pos");
    triggerAudio("beep");
  };

  // Calculations
  const subtotal = cartItems.reduce(
    (acc, item) => acc + item.unitPrice * item.quantity,
    0
  );
  const discountAmount = (subtotal * discountPercent) / 100;
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const taxAmount = (taxableAmount * (settings.taxRate || 0)) / 100;
  const grandTotal = taxableAmount + taxAmount;

  // Complete Payment & Save to Supabase
  const handleCompletePayment = async ({ paymentMethod, cashPaid, changeDue }) => {
    const newOrderNumber = (orders.length + 1033).toString();
    const newOrder = {
      id: "ORD-" + newOrderNumber,
      orderNumber: newOrderNumber,
      type: orderType,
      table: selectedTable || "-",
      customer: customerName || (orderType === "takeaway" ? "زبون سفري" : "عميل صالة"),
      items: cartItems.map((ci) => ({
        name: ci.product.name,
        qty: ci.quantity,
        price: ci.unitPrice,
        selectedOptions: ci.selectedOptions,
        notes: ci.notes
      })),
      subtotal,
      tax: taxAmount,
      discount: discountAmount,
      total: grandTotal,
      cashPaid,
      changeDue,
      status: "in_kitchen",
      paymentMethod,
      createdAt: new Date().toISOString(),
      notes: customerName ? `عميل: ${customerName}` : ""
    };

    // Save in Supabase & state
    await createOrder(newOrder);

    // Update Table status if Dine-In
    if (orderType === "dine_in" && selectedTable) {
      const foundTable = tables.find((t) => t.name === selectedTable);
      if (foundTable) {
        updateTableStatus(foundTable.id, "occupied");
      }
    }

    // Audio & Confetti
    triggerAudio("success");
    try {
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
    } catch (e) {}

    logAuditAction(
      "إتمام عملية دفع",
      `فاتورة #${newOrder.orderNumber} بمبلغ ${grandTotal.toFixed(2)} ${settings.currency} (${paymentMethod})`
    );

    // Reset Cart
    setCartItems([]);
    setDiscountPercent(0);
    setSelectedTable("");
    setCustomerName("");
    setIsPaymentOpen(false);

    // Open Thermal Receipt modal
    setActiveReceiptOrder(newOrder);
  };

  // Update kitchen order status
  const handleKitchenStatusChange = async (orderId, newStatus) => {
    await updateOrderStatus(orderId, newStatus);
    if (newStatus === "ready") {
      triggerAudio("kitchen");
    } else {
      triggerAudio("beep");
    }
    logAuditAction("تحديث حالة طلب مطبخ", `تغيير حالة الطلب ${orderId} إلى ${newStatus}`);
  };

  // Auth Loading Screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-200">
        <div className="w-12 h-12 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin mb-4"></div>
        <p className="font-bold text-sm text-slate-400">جاري الاتصال السحابي بقاعدة البيانات...</p>
      </div>
    );
  }

  // Not Logged In -> Show Login Screen
  if (!user && !profile) {
    return <LoginView />;
  }

  const pendingKitchenCount = orders.filter((o) => o.status === "in_kitchen" || o.status === "cooking").length;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans text-slate-100 overflow-x-hidden" dir="rtl">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        heldOrdersCount={heldOrders.length}
        openHeldOrders={() => setIsHeldModalOpen(true)}
        settings={settings}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        pendingKitchenCount={pendingKitchenCount}
        currentUser={profile}
        onLogout={logout}
      />

      {/* Main View Router */}
      <div className="flex-grow flex flex-col">
        {activeTab === "pos" && (role === "admin" || role === "cashier") && (
          <POSView
            products={products}
            categories={categories}
            cartItems={cartItems}
            orderType={orderType}
            setOrderType={setOrderType}
            selectedTable={selectedTable}
            setSelectedTable={setSelectedTable}
            tables={tables}
            onAddToCart={handleAddToCart}
            onUpdateQty={handleUpdateQty}
            onRemoveItem={handleRemoveItem}
            onClearCart={handleClearCart}
            onHoldOrder={handleHoldOrder}
            onOpenPayment={() => setIsPaymentOpen(true)}
            currency={settings.currency}
            settings={settings}
            discountPercent={discountPercent}
            setDiscountPercent={(p) => {
              setDiscountPercent(p);
              if (p > 0) logAuditAction("تطبيق خصم", `خصم بنسبة ${p}%`);
            }}
            customerName={customerName}
            setCustomerName={setCustomerName}
          />
        )}

        {activeTab === "kitchen" && (
          <KitchenDisplay
            orders={orders}
            onUpdateOrderStatus={handleKitchenStatusChange}
            currency={settings.currency}
            settings={settings}
            onPlayBell={() => triggerAudio("kitchen")}
            readOnly={role === "cashier"}
          />
        )}

        {activeTab === "tables" && (role === "admin" || role === "cashier") && (
          <TablesView
            tables={tables}
            onSelectTableForOrder={handleSelectTableForOrder}
            onUpdateTableStatus={updateTableStatus}
            currency={settings.currency}
          />
        )}

        {activeTab === "reports" && role === "admin" && (
          <ReportsView
            orders={orders}
            currency={settings.currency}
            settings={settings}
            currentUser={profile}
            onViewReceipt={(order) => {
              setActiveReceiptOrder(order);
              logAuditAction("معاينة فاتورة", `فاتورة #${order.orderNumber || order.id}`);
            }}
          />
        )}

        {activeTab === "settings" && role === "admin" && (
          <SettingsView
            settings={settings}
            setSettings={setSettings}
            products={products}
            setProducts={setProducts}
            categories={categories}
            onResetData={() => {}}
            onSaveToLocalStorage={() => {}}
            currentUser={profile}
          />
        )}
      </div>

      {/* Payment Modal */}
      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        totalAmount={grandTotal}
        currency={settings.currency}
        onCompletePayment={handleCompletePayment}
        orderType={orderType}
        table={selectedTable}
        customer={customerName}
      />

      {/* Thermal Receipt Modal */}
      {activeReceiptOrder && (
        <ThermalReceipt
          order={activeReceiptOrder}
          settings={settings}
          onClose={() => setActiveReceiptOrder(null)}
          onNewOrder={() => {
            setActiveReceiptOrder(null);
            setActiveTab("pos");
          }}
        />
      )}

      {/* Held Orders Modal */}
      <HoldOrdersModal
        isOpen={isHeldModalOpen}
        onClose={() => setIsHeldModalOpen(false)}
        heldOrders={heldOrders}
        onRecallOrder={handleRecallOrder}
        onDeleteHeldOrder={handleDeleteHeldOrder}
        currency={settings.currency}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <MainApp />
      </DataProvider>
    </AuthProvider>
  );
}

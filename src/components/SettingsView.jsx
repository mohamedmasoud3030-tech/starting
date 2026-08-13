import React, { useState } from "react";
import {
  Settings,
  Store,
  Plus,
  Trash2,
  Edit2,
  Save,
  Download,
  Upload,
  RotateCcw,
  CheckCircle,
  Sparkles,
  Utensils,
  Percent,
  Receipt,
  Users,
  ShieldCheck,
  CreditCard,
  ChefHat,
  Lock,
  UserPlus,
  KeyRound,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  ShieldAlert
} from "lucide-react";
import { logAction } from "../utils/audit";
import { playSound } from "../utils/audio";
import { initialUsers } from "../types/data";

export default function SettingsView({
  settings,
  setSettings,
  products,
  setProducts,
  categories,
  onResetData,
  onSaveToLocalStorage,
  users = [],
  setUsers,
  onSaveUsersToLocalStorage,
  currentUser
}) {
  const [activeTab, setActiveTab] = useState("store"); // store, menu, users, data
  const [formSettings, setFormSettings] = useState({ ...settings });
  const [isSavedNotice, setIsSavedNotice] = useState(false);

  // New product state
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    category: "burgers",
    price: "",
    cost: "",
    calories: "",
    image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80",
    badge: "جديد ⚡",
    description: "",
    modifiers: []
  });

  // User Management State
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userFormError, setUserFormError] = useState("");
  const [newUserForm, setNewUserForm] = useState({
    username: "",
    password: "",
    fullName: "",
    role: "cashier"
  });

  const handleSaveSettings = (e) => {
    e.preventDefault();
    setSettings(formSettings);
    onSaveToLocalStorage(formSettings, products);
    logAction("تغيير بيانات المطعم", `تحديث بيانات المطعم: ${formSettings.restaurantName} والضريبة: ${formSettings.taxRate}%`);
    playSound("success");
    setIsSavedNotice(true);
    setTimeout(() => setIsSavedNotice(false), 3000);
  };

  const handleAddProduct = (e) => {
    e.preventDefault();
    if (!newProduct.name || !newProduct.price) return;

    const created = {
      ...newProduct,
      id: "p_" + Date.now(),
      price: parseFloat(newProduct.price) || 0,
      cost: parseFloat(newProduct.cost) || 0,
      calories: parseInt(newProduct.calories) || 0
    };

    const updatedProducts = [created, ...products];
    setProducts(updatedProducts);
    onSaveToLocalStorage(settings, updatedProducts);
    logAction("إضافة صنف مينيو", `إضافة الوجبة: ${created.name} بسعر ${created.price} ${settings.currency}`);
    playSound("success");
    setIsAddingProduct(false);
    setNewProduct({
      name: "",
      category: "burgers",
      price: "",
      cost: "",
      calories: "",
      image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80",
      badge: "",
      description: "",
      modifiers: []
    });
  };

  const handleDeleteProduct = (productId) => {
    const prod = products.find((p) => p.id === productId);
    if (window.confirm(`هل أنت متأكد من رغبتك في حذف "${prod?.name || 'هذا الصنف'}" من المنيو؟`)) {
      const updated = products.filter((p) => p.id !== productId);
      setProducts(updated);
      onSaveToLocalStorage(settings, updated);
      logAction("حذف صنف مينيو", `حذف الوجبة: ${prod?.name || productId}`);
      playSound("remove");
    }
  };

  // User management operations
  const handleCreateUser = (e) => {
    e.preventDefault();
    setUserFormError("");

    const usernameClean = newUserForm.username.trim().toLowerCase();
    if (!usernameClean || !newUserForm.password) {
      setUserFormError("يرجى إدخال اسم المستخدم وكلمة المرور.");
      return;
    }

    if (users.some((u) => u.username.toLowerCase() === usernameClean)) {
      setUserFormError("اسم المستخدم موجود بالفعل. اختر اسماً آخر.");
      return;
    }

    // NOTE: In production connected with a backend, plain-text passwords must be hashed using bcrypt or Argon2.
    const createdUser = {
      id: "u_" + Date.now(),
      username: usernameClean,
      password: newUserForm.password,
      fullName: newUserForm.fullName.trim() || usernameClean,
      role: newUserForm.role,
      isActive: true,
      mustChangePassword: true, // Forces password change on first login
      createdAt: new Date().toISOString()
    };

    const updatedUsers = [...users, createdUser];
    setUsers(updatedUsers);
    onSaveUsersToLocalStorage(updatedUsers);
    logAction("إضافة مستخدم", `إضافة مستخدم جديد: ${createdUser.username} (${createdUser.fullName}) بالدور: ${createdUser.role}`);
    playSound("success");
    setIsAddUserModalOpen(false);
    setNewUserForm({ username: "", password: "", fullName: "", role: "cashier" });
  };

  const handleUpdateUser = (e) => {
    e.preventDefault();
    if (!editingUser) return;

    const updatedUsers = users.map((u) =>
      u.id === editingUser.id
        ? {
            ...u,
            fullName: editingUser.fullName,
            role: editingUser.role,
            password: editingUser.password
          }
        : u
    );

    setUsers(updatedUsers);
    onSaveUsersToLocalStorage(updatedUsers);
    logAction("تعديل مستخدم", `تعديل بيانات المستخدم: ${editingUser.username} والدور: ${editingUser.role}`);
    playSound("success");
    setEditingUser(null);
  };

  const handleToggleUserActive = (user) => {
    if (user.username === "admin") {
      alert("لا يمكن تعطيل حساب المسؤول الرئيسي (admin) للحفاظ على إمكانية إدارة النظام.");
      return;
    }

    const newStatus = !user.isActive;
    const updatedUsers = users.map((u) =>
      u.id === user.id ? { ...u, isActive: newStatus } : u
    );

    setUsers(updatedUsers);
    onSaveUsersToLocalStorage(updatedUsers);
    logAction("تغيير حالة مستخدم", `تم ${newStatus ? 'تفعيل' : 'تعطيل'} حساب المستخدم: ${user.username}`);
    playSound(newStatus ? "beep" : "remove");
  };

  const handleDeleteUser = (user) => {
    if (user.username === "admin") {
      alert("لا يمكن حذف حساب المسؤول الرئيسي (admin).");
      return;
    }

    if (user.id === currentUser?.userId) {
      alert("لا يمكنك حذف حسابك الحالي أثناء تسجيل الدخول به.");
      return;
    }

    if (window.confirm(`هل أنت متأكد من رغبتك في حذف المستخدم "${user.fullName || user.username}" نهائياً؟`)) {
      const updatedUsers = users.filter((u) => u.id !== user.id);
      setUsers(updatedUsers);
      onSaveUsersToLocalStorage(updatedUsers);
      logAction("حذف مستخدم", `حذف المستخدم: ${user.username} (${user.role})`);
      playSound("remove");
    }
  };

  const handleRestoreDefaultUsers = () => {
    if (window.confirm("هل أنت متأكد من استعادة المستخدمين الافتراضيين (admin, cashier, kitchen)؟")) {
      setUsers(initialUsers);
      onSaveUsersToLocalStorage(initialUsers);
      logAction("استعادة المستخدمين الافتراضيين", "تمت استعادة المستخدمين الافتراضيين إلى حالتهم الأصلية");
      playSound("success");
      alert("تمت استعادة المستخدمين الافتراضيين بنجاح!");
    }
  };

  // Export JSON
  const handleExportJSON = () => {
    const dataToExport = {
      settings,
      products,
      categories,
      users: users.map((u) => ({ ...u, password: u.password })),
      exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `restaurant-pos-backup-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    logAction("تصدير نسخة احتياطية", "تم تنزيل وتصدير ملف النسخة الاحتياطية JSON");
  };

  // Import JSON
  const handleImportJSON = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (parsed.settings && parsed.products) {
          setSettings(parsed.settings);
          setFormSettings(parsed.settings);
          setProducts(parsed.products);
          onSaveToLocalStorage(parsed.settings, parsed.products);
          if (parsed.users && Array.isArray(parsed.users)) {
            setUsers(parsed.users);
            onSaveUsersToLocalStorage(parsed.users);
          }
          logAction("استعادة نسخة احتياطية", "تم استيراد نسخة احتياطية وتحديث بيانات النظام والمنيو والمستخدمين");
          playSound("success");
          alert("تم استيراد البيانات وقائمة الطعام والمستخدمين بنجاح!");
        } else {
          alert("الملف لا يحتوي على بنية البيانات الصحيحة.");
        }
      } catch (err) {
        alert("حدث خطأ أثناء قراءة ملف النسخة الاحتياطية.");
      }
    };
    reader.readAsText(file);
  };

  const roleBadges = {
    admin: { label: "مدير عام", color: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: ShieldCheck },
    cashier: { label: "كاشير", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", icon: CreditCard },
    kitchen: { label: "مطبخ", color: "bg-blue-500/20 text-blue-300 border-blue-500/30", icon: ChefHat }
  };

  return (
    <div className="h-[calc(100vh-62px)] bg-slate-950 p-4 flex flex-col gap-4 overflow-y-auto select-none">
      {/* Settings Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-extrabold text-base text-white">لوحة التخصيص وإدارة النظام</h2>
            <p className="text-xs text-slate-400">
              تعديل بيانات المطعم، المنيو، المستخدمين والصلاحيات، والنسخ الاحتياطي
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab("store")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === "store"
                ? "bg-orange-500 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            بيانات المطعم والفاتورة
          </button>

          <button
            onClick={() => setActiveTab("menu")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === "menu"
                ? "bg-orange-500 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            إدارة المنيو ({products.length})
          </button>

          {currentUser?.role === "admin" && (
            <button
              onClick={() => setActiveTab("users")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === "users"
                  ? "bg-orange-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>المستخدمون ({users.length})</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab("data")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === "data"
                ? "bg-orange-500 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            النسخ الاحتياطي
          </button>
        </div>
      </div>

      {isSavedNotice && (
        <div className="bg-emerald-500/20 border border-emerald-500 text-emerald-300 px-4 py-3 rounded-2xl flex items-center gap-2 text-xs font-bold animate-in fade-in">
          <CheckCircle className="w-4 h-4" />
          <span>تم حفظ الإعدادات والتعديلات بنجاح في النظام!</span>
        </div>
      )}

      {/* Tab 1: Store & Receipt Settings */}
      {activeTab === "store" && (
        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-4">
            <h3 className="font-extrabold text-sm text-white flex items-center gap-2 border-b border-slate-800 pb-2">
              <Store className="w-4 h-4 text-orange-400" />
              المعلومات الأساسية للمطعم
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">اسم المطعم أو البراند:</label>
                <input
                  type="text"
                  value={formSettings.restaurantName}
                  onChange={(e) => setFormSettings({ ...formSettings, restaurantName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">اسم الفرع:</label>
                  <input
                    type="text"
                    value={formSettings.branchName}
                    onChange={(e) => setFormSettings({ ...formSettings, branchName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">رقم الهاتف / الواتساب:</label>
                  <input
                    type="text"
                    value={formSettings.phone}
                    onChange={(e) => setFormSettings({ ...formSettings, phone: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">العنوان والموقع:</label>
                <input
                  type="text"
                  value={formSettings.address}
                  onChange={(e) => setFormSettings({ ...formSettings, address: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">الرقم الضريبي (VAT ID):</label>
                  <input
                    type="text"
                    value={formSettings.taxNumber}
                    onChange={(e) => setFormSettings({ ...formSettings, taxNumber: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">رمز العملة:</label>
                  <input
                    type="text"
                    placeholder="ر.ع أو ر.س أو $"
                    value={formSettings.currency}
                    onChange={(e) => setFormSettings({ ...formSettings, currency: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-4">
            <h3 className="font-extrabold text-sm text-white flex items-center gap-2 border-b border-slate-800 pb-2">
              <Receipt className="w-4 h-4 text-orange-400" />
              إعدادات الضرائب والفاتورة الحرارية
            </h3>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    نسبة ضريبة القيمة المضافة (%):
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={formSettings.taxRate}
                    onChange={(e) => setFormSettings({ ...formSettings, taxRate: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">رسوم الخدمة (%):</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formSettings.serviceFeeRate || 0}
                    onChange={(e) => setFormSettings({ ...formSettings, serviceFeeRate: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">
                  رسالة ختامية أسفل الفاتورة:
                </label>
                <textarea
                  rows="3"
                  value={formSettings.footerNote}
                  onChange={(e) => setFormSettings({ ...formSettings, footerNote: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                ></textarea>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-3 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 transition"
                >
                  <Save className="w-4 h-4" />
                  <span>حفظ وتطبيق الإعدادات فوراً</span>
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Tab 2: Menu Management */}
      {activeTab === "menu" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-slate-900 border border-slate-800 p-3.5 rounded-2xl">
            <h3 className="font-extrabold text-sm text-white">قائمة الوجبات والأصناف الحالية</h3>
            <button
              onClick={() => setIsAddingProduct(!isAddingProduct)}
              className="px-3.5 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>{isAddingProduct ? "إلغاء الإضافة" : "إضافة صنف جديد"}</span>
            </button>
          </div>

          {/* Add Product Form */}
          {isAddingProduct && (
            <form onSubmit={handleAddProduct} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3 animate-in fade-in">
              <h4 className="font-bold text-xs text-orange-400">إضافة وجبة أو صنف جديد للمنيو</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">اسم الصنف:</label>
                  <input
                    type="text"
                    required
                    placeholder="مثال: برجر دجاج مقرمش"
                    value={newProduct.name}
                    onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">التصنيف:</label>
                  <select
                    value={newProduct.category}
                    onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                  >
                    {categories.filter((c) => c.id !== "all").map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">سعر البيع ({settings.currency}):</label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="مثال: 3.50"
                    value={newProduct.price}
                    onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">رابط الصورة (Image URL):</label>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={newProduct.image}
                    onChange={(e) => setNewProduct({ ...newProduct, image: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">السعرات الحرارية:</label>
                  <input
                    type="number"
                    placeholder="مثال: 550"
                    value={newProduct.calories}
                    onChange={(e) => setNewProduct({ ...newProduct, calories: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">شارة الصنف (Badge):</label>
                  <input
                    type="text"
                    placeholder="مثال: مميز ⭐ أو سبايسي 🌶️"
                    value={newProduct.badge}
                    onChange={(e) => setNewProduct({ ...newProduct, badge: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1 text-xs">وصف ومكونات الصنف:</label>
                <input
                  type="text"
                  placeholder="وصف مختصر لمكونات الوجبة وطريقة تقديمها..."
                  value={newProduct.description}
                  onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddingProduct(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-black"
                >
                  حفظ الصنف وإضافته للمنيو ✓
                </button>
              </div>
            </form>
          )}

          {/* Products List Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="p-3">الصورة</th>
                  <th className="p-3">اسم الصنف</th>
                  <th className="p-3">التصنيف</th>
                  <th className="p-3">السعر</th>
                  <th className="p-3">السعرات</th>
                  <th className="p-3 text-left">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {products.map((prod) => (
                  <tr key={prod.id} className="hover:bg-slate-950/40">
                    <td className="p-3">
                      <img
                        src={prod.image}
                        alt={prod.name}
                        className="w-10 h-10 rounded-xl object-cover"
                      />
                    </td>
                    <td className="p-3 font-bold text-slate-200">{prod.name}</td>
                    <td className="p-3 text-slate-400">{prod.category}</td>
                    <td className="p-3 font-mono font-bold text-amber-400">
                      {Number(prod.price).toFixed(2)} {settings.currency}
                    </td>
                    <td className="p-3 text-slate-400">{prod.calories ? `${prod.calories} cal` : "-"}</td>
                    <td className="p-3 text-left">
                      <button
                        onClick={() => handleDeleteProduct(prod.id)}
                        className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white transition"
                        title="حذف من المنيو"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Users Management (Admin only) */}
      {activeTab === "users" && currentUser?.role === "admin" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
            <div>
              <h3 className="font-extrabold text-sm text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-orange-400" />
                إدارة المستخدمين وحسابات الوردية
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                إضافة كاشيرات، شيفات مطبخ، وتحديد الصلاحيات وكلمات المرور
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleRestoreDefaultUsers}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-bold transition flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>استعادة المستخدمين الافتراضيين</span>
              </button>

              <button
                onClick={() => setIsAddUserModalOpen(true)}
                className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-md shadow-orange-500/20"
              >
                <UserPlus className="w-4 h-4" />
                <span>إضافة مستخدم جديد</span>
              </button>
            </div>
          </div>

          {/* Users Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-950/60">
                  <th className="p-3.5">الاسم والمستخدم</th>
                  <th className="p-3.5">الدور والصلاحية</th>
                  <th className="p-3.5">حالة التفعيل</th>
                  <th className="p-3.5">تاريخ الإنشاء</th>
                  <th className="p-3.5 text-left">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {users.map((user) => {
                  const roleConfig = roleBadges[user.role] || roleBadges.cashier;
                  const RoleIcon = roleConfig.icon;
                  const isCurrentSessionUser = user.id === currentUser?.userId;

                  return (
                    <tr key={user.id} className="hover:bg-slate-950/40 transition">
                      <td className="p-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-700 to-slate-800 border border-slate-700 text-white font-bold text-xs flex items-center justify-center">
                            {(user.fullName || user.username).charAt(0)}
                          </div>
                          <div>
                            <span className="font-bold text-slate-200 block">
                              {user.fullName || user.username}
                              {isCurrentSessionUser && (
                                <span className="text-[10px] text-amber-400 mr-1.5 font-normal">(حسابك الحالي)</span>
                              )}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono">@{user.username}</span>
                          </div>
                        </div>
                      </td>

                      <td className="p-3.5">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5 ${roleConfig.color}`}>
                          <RoleIcon className="w-3.5 h-3.5" />
                          <span>{roleConfig.label}</span>
                        </span>
                      </td>

                      <td className="p-3.5">
                        <button
                          onClick={() => handleToggleUserActive(user)}
                          disabled={user.username === "admin"}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                            user.isActive
                              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                              : "bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700"
                          } ${user.username === "admin" ? "opacity-75 cursor-not-allowed" : "cursor-pointer"}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${user.isActive ? "bg-emerald-400" : "bg-slate-500"}`}></span>
                          <span>{user.isActive ? "نشط ومفعل" : "معطل"}</span>
                        </button>
                      </td>

                      <td className="p-3.5 text-slate-400 font-mono text-[11px]">
                        {new Date(user.createdAt || Date.now()).toLocaleDateString("ar-OM")}
                      </td>

                      <td className="p-3.5 text-left">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setEditingUser({ ...user })}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                            title="تعديل المستخدم"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {user.username !== "admin" && (
                            <button
                              onClick={() => handleDeleteUser(user)}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white transition"
                              title="حذف المستخدم"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-3 rounded-xl text-xs text-slate-400">
            <span className="font-bold text-slate-300">ملاحظة أمنية:</span> عند إنشاء مستخدم جديد، يُطلب منه تغيير كلمة المرور بشكل إلزامي عند أول عملية تسجيل دخول لضمان الخصوصية.
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-extrabold text-sm text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-orange-400" />
                إضافة مستخدم جديد
              </h3>
              <button
                onClick={() => {
                  setIsAddUserModalOpen(false);
                  setUserFormError("");
                }}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>

            {userFormError && (
              <div className="bg-rose-500/15 border border-rose-500/30 text-rose-300 p-2.5 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{userFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">الاسم الكامل:</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: يوسف خالد"
                  value={newUserForm.fullName}
                  onChange={(e) => setNewUserForm({ ...newUserForm, fullName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">اسم المستخدم (Username):</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: yousef"
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">كلمة المرور الأولية:</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-orange-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  سيُطلب من المستخدم تغييرها عند أول تسجيل دخول.
                </span>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">الدور والصلاحية:</label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                >
                  <option value="cashier">كاشير الصالة (POS + طاولات + مشاهدة المطبخ)</option>
                  <option value="kitchen">شيف المطبخ (شاشة KDS فقط)</option>
                  <option value="admin">مدير عام (صلاحيات كاملة على كل النظام)</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-black text-xs shadow-md shadow-orange-500/20"
                >
                  إنشاء المستخدم ✓
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-extrabold text-sm text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-orange-400" />
                تعديل بيانات المستخدم: @{editingUser.username}
              </h3>
              <button
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">اسم المستخدم (ثابت):</label>
                <input
                  type="text"
                  disabled
                  value={editingUser.username}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 text-slate-400 font-mono cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">الاسم الكامل:</label>
                <input
                  type="text"
                  required
                  value={editingUser.fullName}
                  onChange={(e) => setEditingUser({ ...editingUser, fullName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">تغيير كلمة المرور:</label>
                <input
                  type="text"
                  required
                  value={editingUser.password}
                  onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">الدور والصلاحية:</label>
                <select
                  disabled={editingUser.username === "admin"}
                  value={editingUser.role}
                  onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-orange-500 disabled:opacity-60"
                >
                  <option value="cashier">كاشير الصالة</option>
                  <option value="kitchen">شيف المطبخ</option>
                  <option value="admin">مدير عام</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-black text-xs shadow-md shadow-orange-500/20"
                >
                  حفظ التعديلات ✓
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tab 4: Data & Backup */}
      {activeTab === "data" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3">
            <h3 className="font-extrabold text-sm text-white flex items-center gap-2">
              <Download className="w-4 h-4 text-blue-400" />
              تصدير نسخة احتياطية (Export Backup)
            </h3>
            <p className="text-xs text-slate-400">
              قم بتنزيل كافة بيانات المطعم، المنيو، المستخدمين والإعدادات كملف JSON لحفظها أو نقلها لجهاز آخر.
            </p>
            <button
              onClick={handleExportJSON}
              className="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition"
            >
              <Download className="w-4 h-4" />
              <span>تنزيل ملف النسخة الاحتياطية JSON</span>
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3">
            <h3 className="font-extrabold text-sm text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-400" />
              استيراد نسخة احتياطية (Import Backup)
            </h3>
            <p className="text-xs text-slate-400">
              اختر ملف JSON محفوظ مسبقاً لاستعادة قائمة الطعام والمستخدمين والإعدادات بالكامل.
            </p>
            <label className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition border border-slate-700">
              <Upload className="w-4 h-4" />
              <span>اختيار ملف واستيراده</span>
              <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
            </label>
          </div>

          <div className="md:col-span-2 bg-rose-950/20 border border-rose-500/30 p-4 rounded-2xl space-y-3">
            <h3 className="font-extrabold text-sm text-rose-400 flex items-center gap-2">
              <RotateCcw className="w-4 h-4" />
              إعادة ضبط المصنع واستعادة البيانات التجريبية
            </h3>
            <p className="text-xs text-slate-400">
              سيتم مسح التعديلات المحلية وإعادة تعيين المنيو والمستخدمين والإعدادات الأصلية الافتراضية.
            </p>
            <button
              onClick={onResetData}
              className="py-2 px-4 rounded-xl bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white font-bold text-xs flex items-center gap-2 transition"
            >
              <span>إعادة الضبط الافتراضي</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

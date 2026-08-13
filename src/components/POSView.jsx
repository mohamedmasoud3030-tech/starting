import React, { useState } from "react";
import {
  Search,
  Sparkles,
  Utensils,
  Sandwich,
  Pizza,
  Flame,
  Soup,
  Cake,
  GlassWater,
  Coffee,
  X
} from "lucide-react";
import ProductCard from "./ProductCard";
import Cart from "./Cart";
import ModifierModal from "./ModifierModal";

const categoryIcons = {
  Utensils,
  Sandwich,
  Pizza,
  Flame,
  Soup,
  Cake,
  GlassWater,
  Coffee
};

export default function POSView({
  products,
  categories,
  cartItems,
  orderType,
  setOrderType,
  selectedTable,
  setSelectedTable,
  tables,
  onAddToCart,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  onHoldOrder,
  onOpenPayment,
  currency,
  settings,
  discountPercent,
  setDiscountPercent,
  customerName,
  setCustomerName
}) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeModalProduct, setActiveModalProduct] = useState(null);

  // Filter products by category and search
  const filteredProducts = products.filter((item) => {
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const handleProductSelect = (product) => {
    // If product has modifiers, open modifier modal
    if (product.modifiers && product.modifiers.length > 0) {
      setActiveModalProduct(product);
    } else {
      // Direct add to cart
      onAddToCart({
        product,
        quantity: 1,
        unitPrice: Number(product.price),
        selectedOptions: [],
        notes: ""
      });
    }
  };

  return (
    <div className="flex flex-col lg:flex-row flex-grow h-[calc(100vh-62px)] overflow-hidden bg-slate-950">
      {/* Main Catalog Area */}
      <main className="flex-grow flex flex-col h-full overflow-hidden p-3 lg:p-4 gap-3">
        {/* Search & Categories Bar */}
        <div className="flex flex-col gap-2.5 flex-shrink-0">
          {/* Search box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ابحث عن وجبة، مشروب، أو حلوى..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 focus:border-orange-500 rounded-2xl pr-10 pl-10 py-2.5 text-xs md:text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Categories Horizontal Scroll */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar select-none">
            {categories.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              const IconComponent = categoryIcons[cat.icon] || Utensils;
              const productCount =
                cat.id === "all"
                  ? products.length
                  : products.filter((p) => p.category === cat.id).length;

              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-150 flex-shrink-0 ${
                    isSelected
                      ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20 scale-[1.02]"
                      : "bg-slate-900/90 text-slate-300 hover:bg-slate-800 border border-slate-800/80"
                  }`}
                >
                  <IconComponent className="w-3.5 h-3.5" />
                  <span>{cat.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-semibold ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {productCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Products Grid */}
        <div className="flex-grow overflow-y-auto pr-1">
          {filteredProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
              <div className="w-16 h-16 rounded-3xl bg-slate-900 flex items-center justify-center text-2xl mb-2">
                🔍
              </div>
              <p className="font-bold text-sm text-slate-300">لم نجد أي صنف يطابق بحثك</p>
              <p className="text-xs text-slate-500 mt-1">
                جرب البحث بكلمة أخرى أو اختر تصنيفاً مختلفاً
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 pb-8">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  currency={currency}
                  onSelect={handleProductSelect}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Cart Sidebar */}
      <Cart
        cartItems={cartItems}
        orderType={orderType}
        setOrderType={setOrderType}
        selectedTable={selectedTable}
        setSelectedTable={setSelectedTable}
        tables={tables}
        onUpdateQty={onUpdateQty}
        onRemoveItem={onRemoveItem}
        onClearCart={onClearCart}
        onHoldOrder={onHoldOrder}
        onOpenPayment={onOpenPayment}
        currency={currency}
        settings={settings}
        discountPercent={discountPercent}
        setDiscountPercent={setDiscountPercent}
        customerName={customerName}
        setCustomerName={setCustomerName}
      />

      {/* Modifier Modal */}
      <ModifierModal
        product={activeModalProduct}
        currency={currency}
        isOpen={!!activeModalProduct}
        onClose={() => setActiveModalProduct(null)}
        onAddToCart={onAddToCart}
      />
    </div>
  );
}

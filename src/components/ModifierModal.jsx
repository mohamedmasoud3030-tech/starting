import React, { useState } from "react";
import { X, Check, Plus, Minus, Flame, Sparkles } from "lucide-react";

export default function ModifierModal({ product, currency, isOpen, onClose, onAddToCart }) {
  if (!isOpen || !product) return null;

  // Selected options state
  const [selectedSingleOptions, setSelectedSingleOptions] = useState(() => {
    const initial = {};
    if (product.modifiers) {
      product.modifiers.forEach((mod) => {
        if (mod.required && mod.options && mod.options.length > 0) {
          initial[mod.id] = mod.options[0];
        }
      });
    }
    return initial;
  });

  const [selectedMultipleOptions, setSelectedMultipleOptions] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [specialInstructions, setSpecialInstructions] = useState("");

  // Calculate dynamic price
  let calculatedUnitPrice = Number(product.price);

  Object.values(selectedSingleOptions).forEach((opt) => {
    if (opt && opt.price) calculatedUnitPrice += Number(opt.price);
  });

  Object.values(selectedMultipleOptions).forEach((opts) => {
    if (Array.isArray(opts)) {
      opts.forEach((opt) => {
        if (opt && opt.price) calculatedUnitPrice += Number(opt.price);
      });
    }
  });

  const totalPrice = calculatedUnitPrice * quantity;

  const handleSingleSelect = (modId, option) => {
    setSelectedSingleOptions((prev) => ({
      ...prev,
      [modId]: option
    }));
  };

  const handleMultipleToggle = (modId, option) => {
    setSelectedMultipleOptions((prev) => {
      const currentList = prev[modId] || [];
      const exists = currentList.some((item) => item.name === option.name);
      if (exists) {
        return {
          ...prev,
          [modId]: currentList.filter((item) => item.name !== option.name)
        };
      } else {
        return {
          ...prev,
          [modId]: [...currentList, option]
        };
      }
    });
  };

  const handleAdd = () => {
    const formattedOptionsList = [];
    Object.values(selectedSingleOptions).forEach((opt) => {
      if (opt) formattedOptionsList.push(opt.name + (opt.price > 0 ? ` (+${opt.price.toFixed(2)} ${currency})` : ""));
    });
    Object.values(selectedMultipleOptions).forEach((opts) => {
      opts.forEach((opt) => {
        formattedOptionsList.push(opt.name + (opt.price > 0 ? ` (+${opt.price.toFixed(2)} ${currency})` : ""));
      });
    });

    onAddToCart({
      product,
      quantity,
      unitPrice: calculatedUnitPrice,
      selectedOptions: formattedOptionsList,
      notes: specialInstructions
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="relative h-32 bg-slate-950 overflow-hidden flex-shrink-0">
          <img src={product.image} alt={product.name} className="w-full h-full object-cover opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent"></div>
          
          <button
            onClick={onClose}
            className="absolute top-3 left-3 w-8 h-8 rounded-full bg-slate-900/80 text-slate-300 hover:text-white flex items-center justify-center border border-slate-700/60 transition"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="absolute bottom-3 right-4 left-4">
            <h2 className="font-black text-lg text-white">{product.name}</h2>
            <p className="text-xs text-slate-300 line-clamp-1">{product.description}</p>
          </div>
        </div>

        {/* Modifiers Body */}
        <div className="p-4 overflow-y-auto space-y-4 flex-grow text-sm">
          {product.modifiers && product.modifiers.map((mod) => {
            const isMultiple = mod.multiple;
            const currentSelected = isMultiple
              ? selectedMultipleOptions[mod.id] || []
              : selectedSingleOptions[mod.id];

            return (
              <div key={mod.id} className="bg-slate-950/50 p-3.5 rounded-2xl border border-slate-800/80">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                    {mod.name}
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {mod.required ? (
                      <span className="text-amber-400 font-semibold">إلزامي *</span>
                    ) : (
                      "اختياري"
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {mod.options.map((option) => {
                    const isSelected = isMultiple
                      ? currentSelected.some((item) => item.name === option.name)
                      : currentSelected?.name === option.name;

                    return (
                      <button
                        key={option.name}
                        type="button"
                        onClick={() =>
                          isMultiple
                            ? handleMultipleToggle(mod.id, option)
                            : handleSingleSelect(mod.id, option)
                        }
                        className={`flex items-center justify-between p-2.5 rounded-xl border text-xs font-semibold transition ${
                          isSelected
                            ? "bg-orange-500/20 border-orange-500 text-orange-300 shadow-sm"
                            : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-4 h-4 rounded-full flex items-center justify-center border text-[10px] ${
                              isSelected
                                ? "bg-orange-500 border-orange-500 text-white"
                                : "border-slate-700"
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <span>{option.name}</span>
                        </div>
                        {option.price > 0 && (
                          <span className="font-mono text-amber-400 font-bold">
                            +{option.price.toFixed(2)} {currency}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Special notes */}
          <div className="bg-slate-950/50 p-3.5 rounded-2xl border border-slate-800/80">
            <label className="block font-bold text-slate-200 mb-1.5 text-xs">
              ملاحظات وتفضيلات خاصة للمطبخ
            </label>
            <input
              type="text"
              placeholder="مثلاً: بدون بصل، زيادة صوص، قطع اللحم نصف استواء..."
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        {/* Footer Quantity & Add to Cart */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl p-1">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-bold text-sm font-mono text-white">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="w-8 h-8 rounded-xl bg-orange-500/20 hover:bg-orange-500 text-orange-400 hover:text-white flex items-center justify-center transition"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={handleAdd}
            className="flex-grow bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold py-3 px-4 rounded-2xl shadow-lg shadow-orange-500/25 flex items-center justify-between transition active:scale-[0.98]"
          >
            <span>إضافة إلى الطلب</span>
            <span className="font-mono text-base font-black">
              {totalPrice.toFixed(2)} {currency}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

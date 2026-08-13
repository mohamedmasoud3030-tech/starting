import React from "react";
import { Plus, Flame, Sparkles, Layers } from "lucide-react";

export default function ProductCard({ product, currency, onSelect }) {
  const hasModifiers = product.modifiers && product.modifiers.length > 0;

  return (
    <div
      onClick={() => onSelect(product)}
      className="group relative bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-orange-500/50 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-xl hover:shadow-orange-500/10 flex flex-col justify-between select-none active:scale-[0.98]"
    >
      {/* Image & Badges */}
      <div className="relative h-36 w-full overflow-hidden bg-slate-950">
        <img
          src={product.image}
          alt={product.name}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent"></div>

        {/* Top Badges */}
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          {product.badge && (
            <span className="bg-orange-500/90 backdrop-blur-sm text-white text-[11px] font-bold px-2 py-0.5 rounded-full shadow-md">
              {product.badge}
            </span>
          )}
        </div>

        {/* Calories if available */}
        {product.calories && (
          <span className="absolute bottom-2 right-2 text-[10px] bg-slate-900/80 backdrop-blur-sm text-slate-300 px-1.5 py-0.5 rounded-md font-mono flex items-center gap-0.5">
            <Flame className="w-3 h-3 text-amber-400" />
            {product.calories} سعرة
          </span>
        )}

        {/* Modifiers indicator icon */}
        {hasModifiers && (
          <span className="absolute bottom-2 left-2 text-[10px] bg-blue-500/80 backdrop-blur-sm text-white px-1.5 py-0.5 rounded-md font-semibold flex items-center gap-1">
            <Layers className="w-3 h-3" />
            خيارات
          </span>
        )}
      </div>

      {/* Product Details */}
      <div className="p-3 flex flex-col justify-between flex-grow gap-2">
        <div>
          <h3 className="font-bold text-sm text-slate-100 group-hover:text-orange-400 transition-colors line-clamp-1">
            {product.name}
          </h3>
          <p className="text-xs text-slate-400 line-clamp-1 mt-0.5 font-normal">
            {product.description || "وجبة طازجة تحضر بأعلى معايير الجودة"}
          </p>
        </div>

        {/* Price & Action */}
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-800/80">
          <div className="flex items-baseline gap-1">
            <span className="text-base font-black text-amber-400 font-mono">
              {Number(product.price).toFixed(2)}
            </span>
            <span className="text-xs text-slate-400 font-medium">{currency}</span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect(product);
            }}
            className="w-8 h-8 rounded-xl bg-orange-500/20 group-hover:bg-orange-500 text-orange-400 group-hover:text-white flex items-center justify-center transition-all duration-200 shadow-sm"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
}

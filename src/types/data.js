// NOTE: هذا الملف أصبح للزراعة الأولية فقط (Seed Data) — البيانات الفعلية والمزامنة اللحظية تأتي من Supabase

export const initialSettings = {
  restaurantName: "مطعم وبرجر ستوديو",
  branchName: "الفرع الرئيسي - مسقط",
  phone: "+968 9123 4567",
  taxNumber: "300459812400003",
  address: "مسقط، حي الشاطئ - طريق السلطان قابوس",
  currency: "ر.ع", // OMR or SAR can be chosen
  taxRate: 5, // 5% VAT
  serviceFeeRate: 0,
  footerNote: "شكراً لزيارتكم ونتمنى لكم وجبة شهية! ✨",
  autoPrintKitchen: true,
  enableSound: true,
  themeColor: "orange"
};

export const initialUsers = [
  {
    id: "u1",
    email: "admin@restopos.app",
    username: "admin",
    password: "123456",
    role: "admin",
    fullName: "المدير العام (Admin)",
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-01-01T08:00:00.000Z"
  },
  {
    id: "u2",
    email: "cashier@restopos.app",
    username: "cashier",
    password: "123456",
    role: "cashier",
    fullName: "أحمد السعيد (كاشير الصالة)",
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-01-01T08:00:00.000Z"
  },
  {
    id: "u3",
    email: "kitchen@restopos.app",
    username: "kitchen",
    password: "123456",
    role: "kitchen",
    fullName: "الشيف محمود (رئيس المطبخ)",
    isActive: true,
    mustChangePassword: false,
    createdAt: "2026-01-01T08:00:00.000Z"
  }
];

export const initialCategories = [
  { id: "all", name: "كل الأصناف", icon: "Utensils", count: 24 },
  { id: "burgers", name: "البرجر والوجبات", icon: "Sandwich", count: 6 },
  { id: "pizza", name: "البيتزا الإيطالية", icon: "Pizza", count: 4 },
  { id: "shawarma", name: "الشاورما والمشاوي", icon: "Flame", count: 4 },
  { id: "appetizers", name: "المقبلات والبطاطس", icon: "Soup", count: 4 },
  { id: "desserts", name: "الحلويات والمثلجات", icon: "Cake", count: 3 },
  { id: "cold_drinks", name: "العصائر والمشروبات", icon: "GlassWater", count: 4 },
  { id: "hot_coffee", name: "القهوة والمشروبات الساخنة", icon: "Coffee", count: 3 }
];

export const initialProducts = [
  {
    id: "p1",
    name: "برجر كلاسيك ترافل أنجوس",
    category: "burgers",
    price: 3.50,
    cost: 1.40,
    calories: 680,
    image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80",
    badge: "الأكثر مبيعاً 🔥",
    description: "شريحة لحم أنجوس 180غ مع جبنة شيدر معتقة، صوص ترافل خاص وخس طازج في خبز البريوش.",
    modifiers: [
      {
        id: "size",
        name: "الحجم",
        required: true,
        options: [
          { name: "فردي (Single)", price: 0 },
          { name: "دبل لحم (Double)", price: 1.20 },
          { name: "تربل عملاق (Triple)", price: 2.00 }
        ]
      },
      {
        id: "extras",
        name: "إضافات اختيارية",
        multiple: true,
        options: [
          { name: "شريحة جبن إضافية", price: 0.30 },
          { name: "بيكون مقرمش", price: 0.50 },
          { name: "صوص ترافل إضافي", price: 0.25 },
          { name: "بصل مكرمل", price: 0.20 }
        ]
      }
    ]
  },
  {
    id: "p2",
    name: "سموك هاوس بيكون برجر",
    category: "burgers",
    price: 3.80,
    cost: 1.50,
    calories: 750,
    image: "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=600&q=80",
    badge: "مميز ⭐",
    description: "لحم بقري مدخن مع صوص باربكيو مدخن، حلقات بصل مقرمشة وشرائح بيكون مقدد.",
    modifiers: [
      {
        id: "size",
        name: "الحجم",
        required: true,
        options: [
          { name: "عادي", price: 0 },
          { name: "دبل لحم", price: 1.20 }
        ]
      },
      {
        id: "spicy",
        name: "درجة الحرارة",
        required: true,
        options: [
          { name: "عادي (بدون شطة)", price: 0 },
          { name: "سبايسي حار 🌶️", price: 0 },
          { name: "سوبر سبايسي 🔥", price: 0 }
        ]
      }
    ]
  },
  {
    id: "p3",
    name: "كرسبي تشيكن ديناميت",
    category: "burgers",
    price: 2.90,
    cost: 1.10,
    calories: 620,
    image: "https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?auto=format&fit=crop&w=600&q=80",
    badge: "جديد ⚡",
    description: "صدر دجاج مقرمش ذهبي مغطى بصلصة الديناميت الكريمية وسلطة كول سلو طازجة.",
    modifiers: [
      {
        id: "extras",
        name: "إضافات إضافية",
        multiple: true,
        options: [
          { name: "جبن شيدر ذائب", price: 0.30 },
          { name: "هالبينو مقطع", price: 0.20 }
        ]
      }
    ]
  },
  {
    id: "p4",
    name: "سماش برجر بالجبن الذائب",
    category: "burgers",
    price: 2.80,
    cost: 1.00,
    calories: 590,
    image: "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?auto=format&fit=crop&w=600&q=80",
    badge: "",
    description: "قطعتين سماش مقرمشة الحواف مع طبقات جبنة أمريكية ومخلل وصوص خاص.",
    modifiers: []
  },
  {
    id: "p5",
    name: "بيتزا ترافل آند مشروم",
    category: "pizza",
    price: 4.50,
    cost: 1.60,
    calories: 820,
    image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=600&q=80",
    badge: "شيف سبيشال 👨‍🍳",
    description: "عجينة إيطالية مخمرة 48 ساعة مع صلصة الكريمة والترافل، فطر طازج وموزاريلا طازجة.",
    modifiers: [
      {
        id: "crust",
        name: "نوع العجينة",
        required: true,
        options: [
          { name: "نابولي رفيعة ومقرمشة", price: 0 },
          { name: "أطراف محشوة بالجبن", price: 0.80 }
        ]
      }
    ]
  },
  {
    id: "p6",
    name: "بيتزا بيبروني كلاسيك",
    category: "pizza",
    price: 3.90,
    cost: 1.30,
    calories: 780,
    image: "https://images.unsplash.com/photo-1628840042765-356cda07504e?auto=format&fit=crop&w=600&q=80",
    badge: "",
    description: "صلصة طماطم سان مارزانو مع جبنة الموزاريلا الفاخرة وشرائح البيبروني البقري المقرمش.",
    modifiers: []
  },
  {
    id: "p7",
    name: "بيتزا فاهيتا رانش",
    category: "pizza",
    price: 4.20,
    cost: 1.45,
    calories: 810,
    image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=600&q=80",
    badge: "",
    description: "قطع دجاج فاهيتا متبلة، فلفل ألوان، زيتون، وصوص الرانش الغني.",
    modifiers: []
  },
  {
    id: "p8",
    name: "شاورما عربي دبل شيف",
    category: "shawarma",
    price: 2.20,
    cost: 0.80,
    calories: 650,
    image: "https://images.unsplash.com/photo-1529042410759-befb1204b468?auto=format&fit=crop&w=600&q=80",
    badge: "محبوب الجميع ❤️",
    description: "قطع شاورما دجاج متبلة في خبز صاج مقطع، تقدم مع صوص الثومية، مخلل، وبطاطس مقرمشة.",
    modifiers: [
      {
        id: "meat",
        name: "نوع اللحم",
        required: true,
        options: [
          { name: "شاورما دجاج", price: 0 },
          { name: "شاورما لحم بلدي", price: 0.50 },
          { name: "مكس (دجاج ولحم)", price: 0.40 }
        ]
      }
    ]
  },
  {
    id: "p9",
    name: "صحن مشاوي مشكل فاخر",
    category: "shawarma",
    price: 5.50,
    cost: 2.30,
    calories: 890,
    image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=600&q=80",
    badge: "عائلي 🥩",
    description: "سيخ كباب لحم، سيخ شيش طاووق، وسيخ أوصال لحم مشوي على الفحم مع خبز البيواز والمقبلات.",
    modifiers: []
  },
  {
    id: "p10",
    name: "بطاطس جبنة ترافل وبارميزان",
    category: "appetizers",
    price: 1.80,
    cost: 0.60,
    calories: 450,
    image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=600&q=80",
    badge: "مقرمش ✨",
    description: "أصابع بطاطس مقلية ذهبية مغطاة بزيت الترافل الإيطالي، جبن بارميزان وأعشاب طازجة.",
    modifiers: []
  },
  {
    id: "p11",
    name: "ديناميت شرمب مقرمش",
    category: "appetizers",
    price: 2.90,
    cost: 1.20,
    calories: 510,
    image: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=600&q=80",
    badge: "مقرمش 🍤",
    description: "روبيان مقلي مقرمش مغمس بصلصة الديناميت الحارة مع بصل أخضر وسمسم.",
    modifiers: []
  },
  {
    id: "p12",
    name: "موتزاريلا ستيكس مع مارينارا",
    category: "appetizers",
    price: 1.50,
    cost: 0.50,
    calories: 390,
    image: "https://images.unsplash.com/photo-1531749668029-2db88e4276c7?auto=format&fit=crop&w=600&q=80",
    badge: "",
    description: "5 قطع أصابع موزاريلا مقرمشة مطاطية مع صلصة المارينارا الإيطالية الغنية.",
    modifiers: []
  },
  {
    id: "p13",
    name: "كوكيز شوكولاتة ساخنة مع آيسكريم",
    category: "desserts",
    price: 2.00,
    cost: 0.70,
    calories: 520,
    image: "https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=600&q=80",
    badge: "حلوى دافئة 🍪",
    description: "كوكي مقرمش من الخارج وطري من الداخل محشو بقطع الشوكولاتة البلجيكية وبولة آيس كريم فانيليا.",
    modifiers: []
  },
  {
    id: "p14",
    name: "تشيز كيك لوتس نيويورك",
    category: "desserts",
    price: 2.30,
    cost: 0.80,
    calories: 460,
    image: "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?auto=format&fit=crop&w=600&q=80",
    badge: "",
    description: "طبقة غنية وكريمية من التشيز كيك الأصلي مغطاة بزبدة وبسكويت اللوتس المقرمش.",
    modifiers: []
  },
  {
    id: "p15",
    name: "عصير باشن فروت وموجيتو منعش",
    category: "cold_drinks",
    price: 1.60,
    cost: 0.40,
    calories: 180,
    image: "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80",
    badge: "منعش 🍹",
    description: "مزيج منعش من فاكهة الباشن فروت، النعناع الأخضر، الليمون الطازج والصودا المثلجة.",
    modifiers: []
  },
  {
    id: "p16",
    name: "عصير برتقال طبيعي طازج",
    category: "cold_drinks",
    price: 1.20,
    cost: 0.30,
    calories: 120,
    image: "https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=600&q=80",
    badge: "طبيعي 100%",
    description: "برتقال فالنسيا معصور طازجاً عند الطلب بدون سكر مضاف.",
    modifiers: []
  },
  {
    id: "p17",
    name: "مشروب غازي (كولا / سبرايت / فانتا)",
    category: "cold_drinks",
    price: 0.50,
    cost: 0.20,
    calories: 140,
    image: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=600&q=80",
    badge: "",
    description: "علبة باردة 330 مل مع كوب ثلج وشريحة ليمون.",
    modifiers: [
      {
        id: "flavor",
        name: "اختر المشروب",
        required: true,
        options: [
          { name: "كوكاكولا كلاسيك", price: 0 },
          { name: "كوكاكولا زيرو", price: 0 },
          { name: "سبرايت", price: 0 },
          { name: "فانتا برتقال", price: 0 }
        ]
      }
    ]
  },
  {
    id: "p18",
    name: "سبانش لاتيه بارد ومثلج",
    category: "hot_coffee",
    price: 1.80,
    cost: 0.50,
    calories: 230,
    image: "https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=600&q=80",
    badge: "قهوة مختصة ☕",
    description: "شوت إسبريسو مزدوج مع حليب مكثف محلى وحليب طازج مع الثلج.",
    modifiers: []
  },
  {
    id: "p19",
    name: "فلات وايت ساخن كلاسيك",
    category: "hot_coffee",
    price: 1.50,
    cost: 0.35,
    calories: 110,
    image: "https://images.unsplash.com/photo-1577968897966-3d4325b36b61?auto=format&fit=crop&w=600&q=80",
    badge: "",
    description: "ريستريتو مزدوج مع رغوة حليب ناعمة وحريرية ورسمة لاتيه آرت.",
    modifiers: []
  }
];

export const initialTables = [
  { id: "T1", name: "طاولة 1", capacity: 2, section: "الصالة الرئيسية", status: "occupied", orderId: "ORD-101", guests: 2, amount: 6.40, time: "15 دقيقة" },
  { id: "T2", name: "طاولة 2", capacity: 4, section: "الصالة الرئيسية", status: "available", orderId: null, guests: 0, amount: 0, time: "" },
  { id: "T3", name: "طاولة 3", capacity: 4, section: "الصالة الرئيسية", status: "occupied", orderId: "ORD-103", guests: 3, amount: 11.20, time: "30 دقيقة" },
  { id: "T4", name: "طاولة 4", capacity: 6, section: "الصالة الرئيسية", status: "available", orderId: null, guests: 0, amount: 0, time: "" },
  { id: "T5", name: "طاولة 5 (VIP)", capacity: 8, section: "كبائن العائلات", status: "reserved", orderId: null, guests: 6, amount: 0, time: "حجز 8:00 م" },
  { id: "T6", name: "طاولة 6", capacity: 4, section: "كبائن العائلات", status: "available", orderId: null, guests: 0, amount: 0, time: "" },
  { id: "T7", name: "طاولة 7", capacity: 4, section: "كبائن العائلات", status: "occupied", orderId: "ORD-106", guests: 4, amount: 18.50, time: "10 دقائق" },
  { id: "T8", name: "طاولة خارجية 1", capacity: 4, section: "التراس الخارجي", status: "available", orderId: null, guests: 0, amount: 0, time: "" },
  { id: "T9", name: "طاولة خارجية 2", capacity: 2, section: "التراس الخارجي", status: "available", orderId: null, guests: 0, amount: 0, time: "" }
];

export const initialOrders = [
  {
    id: "ORD-1032",
    orderNumber: "1032",
    type: "dine_in",
    table: "طاولة 3",
    customer: "سالم الحارثي",
    items: [
      { name: "برجر كلاسيك ترافل أنجوس", qty: 2, price: 3.50, selectedOptions: ["دبل لحم (+1.20 ر.ع)", "شريحة جبن إضافية"] },
      { name: "بطاطس جبنة ترافل وبارميزان", qty: 1, price: 1.80, selectedOptions: [] },
      { name: "عصير باشن فروت وموجيتو منعش", qty: 2, price: 1.60, selectedOptions: [] }
    ],
    subtotal: 14.60,
    tax: 0.73,
    discount: 0,
    total: 15.33,
    status: "in_kitchen",
    paymentMethod: "unpaid",
    createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    notes: "بدون ثوم في البرجر"
  },
  {
    id: "ORD-1031",
    orderNumber: "1031",
    type: "takeaway",
    table: "-",
    customer: "محمد علي",
    items: [
      { name: "بيتزا ترافل آند مشروم", qty: 1, price: 4.50, selectedOptions: ["نابولي رفيعة ومقرمشة"] },
      { name: "موتزاريلا ستيكس مع مارينارا", qty: 1, price: 1.50, selectedOptions: [] },
      { name: "مشروب غازي", qty: 2, price: 0.50, selectedOptions: ["كوكاكولا كلاسيك"] }
    ],
    subtotal: 7.00,
    tax: 0.35,
    discount: 0.50,
    total: 6.85,
    status: "ready",
    paymentMethod: "card",
    createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    notes: "كاتشب ومايونيز إضافي"
  },
  {
    id: "ORD-1030",
    orderNumber: "1030",
    type: "delivery",
    table: "-",
    customer: "خالد الشامسي (98765432)",
    items: [
      { name: "صحن مشاوي مشكل فاخر", qty: 2, price: 5.50, selectedOptions: [] },
      { name: "شاورما عربي دبل شيف", qty: 1, price: 2.20, selectedOptions: ["شاورما لحم بلدي (+0.50 ر.ع)"] },
      { name: "ديناميت شرمب مقرمش", qty: 1, price: 2.90, selectedOptions: [] }
    ],
    subtotal: 16.10,
    tax: 0.81,
    discount: 0,
    total: 16.91,
    status: "completed",
    paymentMethod: "cash",
    createdAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
    notes: "توصيل شقة 402 عمارة الياسمين"
  }
];

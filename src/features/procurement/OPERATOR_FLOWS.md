# S5B — تدفقات المشغّل للموردين والمشتريات

هذا المستند **للواجهة فقط**. العقد الخلفي المنشور من S5A هو المرجع النهائي، ويُحوَّل إلى `ProcurementDataSource` في `contracts.ts`. لا تنشئ الواجهة مخزوناً أو lifecycle أو صلاحيات من عندها.

## الموردون

1. يفتح المشغّل تبويب **الموردون** ويرى الاسم والنوع والهاتف والحالة، ويمكن للـadapter توفير مؤشرات إضافية مثل آخر طلب/عدد الطلبات المفتوحة إن كان لديه read model مصرح.
2. أنواع المورد تطابق S5A حرفياً: `CATERING_RESTAURANT | CONSUMABLES | EQUIPMENT_RENTAL | GENERAL`.
3. البحث بالاسم أو الهاتف، مع تصفية الحالة والنوع، يعمل ببطاقات مضغوطة لا بجدول عريض.
4. **إضافة مورد** تتحقق من الاسم والنوع والهاتف ثم ترسل intent بمفتاح idempotency ثابت لنفس payload.
5. التفاصيل لا تعرض أي معرّف داخلي. التعديل والإيقاف يظهران وفق capabilities التي أرجعها الـadapter فقط.
6. إيقاف المورد يحتاج تأكيداً صريحاً ولا يوحي بحذف الطلبات السابقة.
7. S5A الحالي ينشر `supplier_summaries` التشغيلي ولا ينشر supplier-detail view يحتوي الملاحظات/الحقول التجارية الكاملة. الـproduction integration **يجب ألا** يقرأ raw table أو يمسح حقولاً مخفية أثناء update؛ يلزم read model تفصيلي cost-gated أو عقد update آمن قبل توصيل تعديل المورد بالكامل.

## طلب التوريد

1. ينشئ OWNER/MANAGER **مسودة** ويختار مورداً نشطاً وتاريخ الطلب، ويمكن ربطها بمناسبة وإضافة موعد توريد متوقع.
2. lifecycle المعروض يطابق S5A حرفياً:
   `DRAFT → APPROVED → SENT → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED`، مع `CANCELLED` terminal حيث يسمح الخادم.
3. بند `CONSUMABLE` لا يقبل نصاً حراً بدل الهوية: يجب اختيار catalog item استهلاكي متتبَّع، والـadapter/S5A يثبتان الوصف والوحدة من المرجع المعتمد.
4. `CATERING_SERVICE` و`OTHER` يمكن أن يكونا non-catalog ويحتاجان وصفاً ووحدة واضحين.
5. كل كمية موجبة بدقة ثلاث خانات عشرية كحد أقصى. negotiated unit cost مطلوب للطلب التجاري ويظل OMR exact 3dp.
6. الكميات exact milli-units والأسعار exact milli-OMR في الواجهة؛ المعاينة تستخدم `money.ts` ولا تجري ضرب binary float.
7. إنشاء الطلب التجاري لا يُتاح من هذه الشاشة إذا لم يكن `canViewCommercialAmounts` مصرحاً؛ التكلفة لا تظهر لمستخدم غير مصرح.
8. أزرار الاعتماد والإرسال والتأكيد والإلغاء والاستلام لا تستنتج transition من status؛ تعتمد حصراً على capability الخادم وتعرض سبب المنع بالعربية.
9. الاعتماد والإرسال والتأكيد والإلغاء تحتاج confirmation صريح. الإلغاء يتطلب سبباً لا يقل عن 3 أحرف وفق S5A.
10. كل mutation يحمل idempotency key ثابتاً لنفس operator intent. أي تعديل فعلي للـpayload يولد key جديداً؛ إعادة المحاولة دون تغيير payload تحتفظ بنفس key.

## الاستلام الجزئي والكامل

1. الاستلام متاح فقط عندما يسمح S5A/capability؛ في العقد الحالي يبدأ من `CONFIRMED` ويستمر في `PARTIALLY_RECEIVED`.
2. الشاشة تعرض لكل بند: **المطلوب، المستلم، المتبقي، الكمية الحالية**.
3. يمكن تعبئة كامل المتبقي بلمسة واحدة أو إدخال جزء منه.
4. الواجهة تمنع الصفر والسالب والدقة الأكبر من 3 وتمنع الكمية الأعلى من `remainingQuantityMilli` الذي وفره S5A. الخادم يبقى المرجع النهائي.
5. بند `CONSUMABLE` يعني استلاماً مادياً؛ أمر S5A هو المسؤول عن الكتابة الذرية إلى S4B `RECEIVE`. React لا يغيّر أي رصيد.
6. بند `CATERING_SERVICE` يظهر كتأكيد تسليم خدمة ولا يدّعي إدخال مخزون.
7. أمر الاستلام يحمل `receivedAt`, `reference`, `notes`, exact lines, و`idempotencyKey`. كل هذه القيم تبقى ثابتة في retry لنفس intent.
8. الرجوع من confirmation إلى edit لا يغير المفتاح وحده؛ يتغير فقط عندما يغيّر المشغّل كمية/مرجع/ملاحظة فعلياً.
9. النجاح حالة واضحة ومستقلة؛ الفشل يعرض رسالة عربية آمنة وزر إعادة محاولة.

## لوحة المناسبة

`EventProcurementPanel` مكوّن مستقل يعرض طلبات المناسبة وحالتها وموعدها والتوريدات المتبقية. المبلغ المتفق عليه لا يظهر إلا إذا:

- منح adapter `canViewCommercialAmounts`؛ و
- أعاد S5A قيمة المبلغ في read model المصرح.

## الربط الإنتاجي المؤجل

لا تعديل في `EventWorkspace.tsx` أو routes/navigation داخل S5B لتجنب تعارض parallel work. بعد دمج S5A/S5B، يلزم integration slice صريح:

1. بناء production `ProcurementDataSource` فوق `src/features/procurement/procurement.api.ts` وread models المصرحة فقط.
2. تحويل PostgreSQL exact numeric إلى milli-units/milli-OMR عند boundary دون float أو silent rounding.
3. اشتقاق capabilities والـcost-filtered reads من backend؛ لا تعِد إنشاء مصفوفة أدوار في React.
4. توفير consumable options من read model S4B المصرح وبهوية catalog/stock صحيحة.
5. حل supplier-detail gap المذكور أعلاه قبل توصيل edit حتى لا تفقد حقولاً غير ظاهرة.
6. إضافة تبويب في `EventWorkspace` يرندر:

   ```tsx
   <EventProcurementPanel
     eventId={eventId}
     dataSource={procurementDataSource}
     access={procurementAccess}
   />
   ```

7. إضافة route/navigation لـ`ProcurementWorkspace` بعد توفير الـadapter. لا يوجد fallback أو persistence تجريبي في runtime.

## أخطاء عربية آمنة

`errors.ts` هو الحد المركزي. لا تعرَض `Error.message` غير المعروفة، SQLSTATE، أسماء constraints، UUIDs، أو stack traces. رموز S5A المعروفة فقط تُحوّل إلى رسائل عربية آمنة؛ أي رمز جديد يبقى رسالة عامة حتى يضاف له mapping صريح.

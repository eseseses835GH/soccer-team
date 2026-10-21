# כוחות בגוגל: מה לעשות (פעם אחת)

הכתובת הראשית: **https://www.kadoregel.com/** (הכתובת בלי www מפנה אליה).

## 1. Google Search Console
1. נכנסים ל־https://search.google.com/search-console עם חשבון Google.
2. "הוספת נכס" ← בוחרים **Domain** (דומיין) ← כותבים `kadoregel.com` (בלי www ובלי https). זה מכסה גם את www.
3. גוגל נותן רשומת TXT שמתחילה ב־`google-site-verification=...` ← מעתיקים.
4. ב־Namecheap: Domain List ← Manage ליד kadoregel.com ← **Advanced DNS** ← Add New Record:
   - Type: `TXT Record`
   - Host: `@`
   - Value: מה שהעתקתם
   - שומרים (✓).
5. חוזרים ל־Search Console ← "אימות". אם לא עובר, מחכים 10–30 דקות ומנסים שוב.

## 2. מפת אתר
ב־Search Console ← **Sitemaps** ← כותבים `https://www.kadoregel.com/sitemap.xml` ← שליחה.

## 3. לבקש אינדוקס
למעלה בשורת החיפוש של Search Console (URL Inspection) ← `https://www.kadoregel.com/` ← **Request indexing** (בקשה להוספה לאינדקס).
אפשר לעשות אותו דבר גם ל־`https://www.kadoregel.com/about.html`.

## 4. (לא חובה) Bing
https://www.bing.com/webmasters ← "Import from Google Search Console" ← מייבא הכול בלחיצה.

## למה לצפות
- הדף יכול להופיע בגוגל אחרי כמה ימים, לפעמים שבועות. בהתחלה בחיפוש `kadoregel` או `כוחות kadoregel`.
- לעלות גבוה על "כוחות כדורגל" לוקח יותר זמן: יש אתרים ואפליקציות ותיקים, וגוגל מדרג לפי כמה אנשים מגיעים, משתמשים ומקשרים.
- הכי עוזר: לשתף את הקישור בקבוצות וואטסאפ של כדורגל, בפורומים, בפייסבוק, ולבקש מחברים עם אתר/בלוג לקשר. כל קישור אמיתי עוזר.
- ב־Search Console, תחת **Performance**, רואים אחרי כמה ימים על אילו חיפושים הופעתם.

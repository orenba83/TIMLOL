# TIMLOL

מערכת תמלול וסיכום דיונים שרצה בדפדפן. תומכת בעברית, באנגלית, ובדיון מעורב באותו משפט.

## Preview

אחרי הקומיט, GitHub Actions בונה ומפרסם את האפליקציה ל-GitHub Pages:

**https://orenba83.github.io/TIMLOL/**

אם זו הפעם הראשונה:

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**
2. הריצו את ה-workflow `Deploy GitHub Pages preview` בטאב Actions אם הוא לא רץ אוטומטית

אפשר גם לפרוס ל-[Vercel](https://vercel.com/new) עם Import של הריפו הזה (`vercel.json` כבר בפרויקט).

## הרצה מקומית

```bash
npm install
npm run dev
```

נדרש מפתח [Google Gemini API](https://aistudio.google.com/apikey). המפתח נשמר רק ב-localStorage של הדפדפן.

## שימוש

1. הדביקו מפתח Gemini
2. בחרו מקור שמע: מיקרופון / שמע מערכת (שתפו טאב עם audio) / משולב
3. בחרו שפה: עברית, English, או עברית + English
4. התחילו הקלטה, או העלו קובץ שמע

## מה תוקן בגרסה הזו

- הצ'אנק האחרון של ההקלטה כבר לא נזרק בעצירה
- מיקרופון + שמע מערכת באמת מעורבבים (לא רק טראק ראשון)
- AudioContext מקבל resume אחרי מחוות המשתמש
- קבצים ארוכים מפוצלים לצ'אנקים במקום שליחה אחת שנכשלת
- Thinking של Gemini 3 כבוי בתמלול כדי שלא ייגמרו טוקני הפלט
- נפילה אוטומטית למודל חלופי אם `gemini-3-flash-preview` לא זמין
- תצוגת טקסט מעורב עברית/אנגלית עם `unicode-bidi: plaintext`
- דיפלוי preview ל-GitHub Pages

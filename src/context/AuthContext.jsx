import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { initialUsers } from "../types/data";

const AuthContext = createContext(null);

const INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const updateActivity = () => {
      lastActivityRef.current = Date.now();
    };

    window.addEventListener("mousedown", updateActivity);
    window.addEventListener("keydown", updateActivity);
    window.addEventListener("touchstart", updateActivity);

    const checkInterval = setInterval(() => {
      if (session || profile) {
        const timePassed = Date.now() - lastActivityRef.current;
        if (timePassed >= INACTIVITY_TIMEOUT_MS) {
          logout();
          alert("تم تسجيل الخروج تلقائياً لعدم وجود نشاط لمدة ساعتين حفاظاً على أمان النظام.");
        }
      }
    }, 30000);

    return () => {
      window.removeEventListener("mousedown", updateActivity);
      window.removeEventListener("keydown", updateActivity);
      window.removeEventListener("touchstart", updateActivity);
      clearInterval(checkInterval);
    };
  }, [session, profile]);

  const fetchProfile = async (userId, userEmail) => {
    if (!isSupabaseConfigured) {
      const demo = initialUsers.find(
        (u) => u.email === userEmail || u.username === userEmail?.split("@")[0]
      ) || {
        id: userId,
        username: userEmail ? userEmail.split("@")[0] : "admin",
        full_name: "المدير العام",
        role: "admin",
        is_active: true,
        force_password_change: false
      };
      setProfile(demo);
      localStorage.setItem("pos_session", JSON.stringify({
        userId: demo.id,
        username: demo.username,
        fullName: demo.full_name || demo.fullName,
        role: demo.role,
        loginTime: Date.now()
      }));
      return demo;
    }

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;

      setProfile(data);
      return data;
    } catch (err) {
      console.error("Error fetching user profile:", err);
      const fallback = {
        id: userId,
        username: userEmail ? userEmail.split("@")[0] : "user",
        full_name: "مستخدم النظام",
        role: "cashier",
        is_active: true,
        force_password_change: false
      };
      setProfile(fallback);
      return fallback;
    }
  };

  useEffect(() => {
    async function initAuth() {
      setLoading(true);
      if (isSupabaseConfigured) {
        try {
          const { data: { session: activeSession } } = await supabase.auth.getSession();
          if (activeSession?.user) {
            setUser(activeSession.user);
            setSession(activeSession);
            await fetchProfile(activeSession.user.id, activeSession.user.email);
          }
        } catch (err) {
          console.error("Failed to restore Supabase session:", err);
        }
      } else {
        const savedSession = localStorage.getItem("pos_session");
        if (savedSession) {
          try {
            const parsed = JSON.parse(savedSession);
            setProfile({
              id: parsed.userId,
              username: parsed.username,
              full_name: parsed.fullName,
              role: parsed.role,
              is_active: true
            });
            setUser({ email: `${parsed.username}@restopos.app`, id: parsed.userId });
            setSession({ user: { email: `${parsed.username}@restopos.app`, id: parsed.userId } });
          } catch (e) {}
        }
      }
      setLoading(false);
    }

    initAuth();

    if (isSupabaseConfigured) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (_event, newSession) => {
          setSession(newSession);
          if (newSession?.user) {
            setUser(newSession.user);
            await fetchProfile(newSession.user.id, newSession.user.email);
          } else {
            setUser(null);
            setProfile(null);
          }
          setLoading(false);
        }
      );

      return () => {
        subscription.unsubscribe();
      };
    }
  }, []);

  const login = async (email, password) => {
    setError(null);
    setLoading(true);

    try {
      if (isSupabaseConfigured) {
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password.trim(),
        });

        if (authError) throw authError;

        if (data?.user) {
          setUser(data.user);
          setSession(data.session);
          const userProf = await fetchProfile(data.user.id, data.user.email);

          if (userProf && !userProf.is_active) {
            await logout();
            throw new Error("هذا الحساب معطل حالياً من قبل الإدارة.");
          }

          lastActivityRef.current = Date.now();
          setLoading(false);
          return { success: true, user: data.user, profile: userProf };
        }
      } else {
        const found = initialUsers.find(
          (u) =>
            (u.email.toLowerCase() === email.toLowerCase() || u.username.toLowerCase() === email.toLowerCase()) &&
            u.password === password
        );

        if (!found) {
          throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة.");
        }

        if (!found.isActive) {
          throw new Error("هذا الحساب معطل حالياً من قبل الإدارة.");
        }

        const userObj = { id: found.id, email: found.email };
        const profObj = {
          id: found.id,
          username: found.username,
          full_name: found.fullName,
          role: found.role,
          is_active: found.isActive,
          force_password_change: found.mustChangePassword
        };

        setUser(userObj);
        setSession({ user: userObj });
        setProfile(profObj);
        localStorage.setItem("pos_session", JSON.stringify({
          userId: found.id,
          username: found.username,
          fullName: found.fullName,
          role: found.role,
          loginTime: Date.now()
        }));

        lastActivityRef.current = Date.now();
        setLoading(false);
        return { success: true, user: userObj, profile: profObj };
      }
    } catch (err) {
      setLoading(false);
      const msg = err.message || "حدث خطأ أثناء تسجيل الدخول";
      setError(msg);
      throw new Error(msg);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut();
      }
    } catch (e) {
      console.warn("Sign out error:", e);
    } finally {
      localStorage.removeItem("pos_session");
      setUser(null);
      setProfile(null);
      setSession(null);
      setLoading(false);
    }
  };

  const isAuthorized = (allowedRoles) => {
    if (!profile) return false;
    if (!allowedRoles || allowedRoles.length === 0) return true;
    return allowedRoles.includes(profile.role);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        role: profile?.role || "cashier",
        loading,
        error,
        login,
        logout,
        isAuthorized,
        setProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

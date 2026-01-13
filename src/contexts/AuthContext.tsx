import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface Profile {
  id: string;
  user_id: string;
  organization_id: string;
  role: string;
  full_name: string | null;
  email: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null; profile: Profile | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    console.debug('[AuthContext] fetchProfile called for userId:', userId);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.debug('[AuthContext] fetchProfile error:', error.message);
        return null;
      }

      console.debug('[AuthContext] fetchProfile result:', data ? 'found' : 'null', data?.role);
      return data as Profile | null;
    } catch (err) {
      console.debug('[AuthContext] fetchProfile exception:', err);
      return null;
    }
  }, []);

  const refreshProfile = useCallback(async (): Promise<Profile | null> => {
    const currentUser = user;
    console.debug('[AuthContext] refreshProfile called, user:', currentUser?.id);
    if (currentUser) {
      const profileData = await fetchProfile(currentUser.id);
      console.debug('[AuthContext] refreshProfile result:', profileData ? 'found' : 'null');
      setProfile(profileData);
      return profileData;
    }
    return null;
  }, [user, fetchProfile]);

  useEffect(() => {
    let isMounted = true;
    console.debug('[AuthContext] Initializing auth...');

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      console.debug('[AuthContext] onAuthStateChange event:', event, 'hasSession:', !!newSession);
      
      if (!isMounted) return;
      
      setSession(newSession);
      setUser(newSession?.user ?? null);

      // On SIGNED_OUT, clear profile immediately
      if (event === 'SIGNED_OUT') {
        console.debug('[AuthContext] SIGNED_OUT - clearing profile');
        setProfile(null);
        setLoading(false);
        return;
      }

      // On auth events with user, defer profile fetch
      if (newSession?.user) {
        setTimeout(async () => {
          if (!isMounted) return;
          console.debug('[AuthContext] Deferred fetchProfile for:', newSession.user.id);
          const profileData = await fetchProfile(newSession.user.id);
          if (isMounted) {
            setProfile(profileData);
            setLoading(false);
          }
        }, 0);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    // THEN check for existing session
    supabase.auth.getSession().then(async ({ data: { session: existingSession } }) => {
      if (!isMounted) return;
      
      console.debug('[AuthContext] getSession result:', !!existingSession);
      setSession(existingSession);
      setUser(existingSession?.user ?? null);

      if (existingSession?.user) {
        const profileData = await fetchProfile(existingSession.user.id);
        if (isMounted) {
          setProfile(profileData);
        }
      }

      if (isMounted) {
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = useCallback(async (email: string, password: string): Promise<{ error: Error | null; profile: Profile | null }> => {
    console.debug('[AuthContext] signIn called for:', email);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      
      if (error) {
        console.debug('[AuthContext] signIn error:', error.message);
        return { error, profile: null };
      }
      
      console.debug('[AuthContext] signIn success, user:', data.user?.id);
      
      // Immediately fetch profile after successful login
      let profileData: Profile | null = null;
      if (data.user) {
        profileData = await fetchProfile(data.user.id);
        console.debug('[AuthContext] signIn - profile fetched:', profileData ? 'found' : 'null');
        setProfile(profileData);
      }
      
      return { error: null, profile: profileData };
    } catch (err) {
      console.debug('[AuthContext] signIn exception:', err);
      return { error: err as Error, profile: null };
    }
  }, [fetchProfile]);

  const signUp = useCallback(async (email: string, password: string, fullName: string): Promise<{ error: Error | null }> => {
    console.debug('[AuthContext] signUp called for:', email);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
          emailRedirectTo: `${window.location.origin}/onboarding`,
        },
      });

      if (error) {
        console.debug('[AuthContext] signUp error:', error.message);
        return { error };
      }
      
      console.debug('[AuthContext] signUp success, session:', !!data.session, 'user:', data.user?.id);
      
      // If we got a session immediately (email confirmation disabled), fetch profile
      if (data.session && data.user) {
        const profileData = await fetchProfile(data.user.id);
        console.debug('[AuthContext] signUp - immediate profile check:', profileData ? 'found' : 'null');
        setProfile(profileData);
      }

      return { error: null };
    } catch (err) {
      console.debug('[AuthContext] signUp exception:', err);
      return { error: err as Error };
    }
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    console.debug('[AuthContext] signOut called');
    setProfile(null);
    setUser(null);
    setSession(null);
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

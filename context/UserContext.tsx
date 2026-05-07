import React, { createContext, useContext, useState, ReactNode } from "react";

type UserContextType = {
  user: any;
  setUser: React.Dispatch<React.SetStateAction<any>>;
};

const UserContext = createContext<UserContextType>({ user: null, setUser: () => {} });

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<any>(null);

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);

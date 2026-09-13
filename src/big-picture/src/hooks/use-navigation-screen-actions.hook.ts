import type { ScreenActions } from "../types";
import { NavigationScreenActionsService } from "../services";
import { useEffect, useRef } from "react";

const navigationScreenActions = NavigationScreenActionsService.getInstance();

interface NavigationScreenActionsOptions {
  priority?: number;
}

export function useNavigationScreenActions(
  actions: ScreenActions,
  options: NavigationScreenActionsOptions = {}
) {
  const registrationIdRef = useRef<number | null>(null);
  const initialActionsRef = useRef(actions);
  const initialPriorityRef = useRef(options.priority);

  useEffect(() => {
    const registration = navigationScreenActions.createRegistration(
      initialActionsRef.current,
      { priority: initialPriorityRef.current }
    );
    registrationIdRef.current = registration.id;

    return registration.unregister;
  }, []);

  useEffect(() => {
    if (registrationIdRef.current === null) {
      return;
    }

    navigationScreenActions.updateActions(registrationIdRef.current, actions, {
      priority: options.priority,
    });
  }, [actions, options.priority]);
}

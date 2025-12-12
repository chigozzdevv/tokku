import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "./button";
import { useWalletAuth } from "@/hooks/use-wallet-auth";
import { useAuth } from "@/providers/auth-provider";

export function Navbar() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { connect, loading, error, clearError } = useWalletAuth();

  useEffect(() => {
    const hero = document.querySelector("section.hero");
    if (!hero) {
      setSolid(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setSolid(!entry.isIntersecting),
      { threshold: 0.01, rootMargin: "-56px 0px 0px 0px" },
    );
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  const handleConnect = useCallback(async () => {
    clearError();
    if (user) {
      navigate("/app");
      setOpen(false);
      return;
    }
    const publicKey = await connect();
    if (publicKey) {
      navigate("/app");
      setOpen(false);
    }
  }, [clearError, connect, navigate, user]);

  return (
    <header className={`nav ${solid ? "solid" : ""}`}>
      <div className="container nav-inner">
        <a href="/" className="brand" aria-label="Tokku home">
          <img src="/tokku-logo.png" alt="Tokku" className="brand-mark" />
        </a>
        <nav className="nav-center" aria-label="Primary">
          <a href="#how-it-works" className="nav-link">
            How it works
          </a>
          <a href="#markets" className="nav-link">
            Markets
          </a>
          <a href="#live-rounds" className="nav-link">
            Rounds
          </a>
          <a href="#faq" className="nav-link">
            FAQ
          </a>
        </nav>
        <div className="nav-cta">
          <Button
            variant="primary"
            aria-label="Connect wallet"
            onClick={handleConnect}
            disabled={loading}
          >
            {user ? "Dashboard" : "Connect"}
          </Button>
        </div>
        <button
          className="nav-burger"
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen(!open)}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 6h16M4 12h16M4 18h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {error ? (
          <span className="nav-error" role="status">
            {error}
          </span>
        ) : null}
      </div>

      {open && (
        <div id="mobile-menu" className="mobile-menu">
          <nav className="mobile-menu-links" aria-label="Mobile">
            <a
              href="#how-it-works"
              className="mobile-link"
              onClick={() => setOpen(false)}
            >
              How it works
            </a>
            <a
              href="#markets"
              className="mobile-link"
              onClick={() => setOpen(false)}
            >
              Markets
            </a>
            <a
              href="#live-rounds"
              className="mobile-link"
              onClick={() => setOpen(false)}
            >
              Rounds
            </a>
            <a
              href="#faq"
              className="mobile-link"
              onClick={() => setOpen(false)}
            >
              FAQ
            </a>
          </nav>
          <Button
            variant="primary"
            onClick={handleConnect}
            disabled={loading}
            style={{ width: "100%" }}
          >
            {user ? "Dashboard" : "Connect Wallet"}
          </Button>
        </div>
      )}
    </header>
  );
}

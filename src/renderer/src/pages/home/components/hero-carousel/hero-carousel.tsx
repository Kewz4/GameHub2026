import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import Skeleton from "react-loading-skeleton";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";

import type { TrendingGame } from "@types";
import "./hero-carousel.scss";

interface Props {
  games: TrendingGame[];
  isLoading: boolean;
}

export function HeroCarousel({ games, isLoading }: Readonly<Props>) {
  const navigate = useNavigate();
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true }, [
    Autoplay({ delay: 6000, stopOnInteraction: false, stopOnMouseEnter: true }),
  ]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  if (isLoading) {
    return <Skeleton className="hero-carousel__skeleton" />;
  }

  if (!games.length) return null;

  // Keyboard access is via the real arrow buttons + dots below (all focusable
  // <button>s) — no global window listener, no keyboard hijack.
  return (
    <section className="hero-carousel" aria-label="Featured">
      <div className="hero-carousel__viewport" ref={emblaRef}>
        <div className="hero-carousel__container">
          {games.map((game, index) => (
            <button
              type="button"
              key={game.uri}
              className="hero-carousel__slide"
              onClick={() => navigate(game.uri)}
            >
              <img
                src={game.libraryHeroImageUrl ?? undefined}
                alt={game.description ?? game.title}
                className="hero-carousel__media"
                // Only the first slide is the LCP image; the rest lazy-load.
                loading={index === 0 ? "eager" : "lazy"}
                decoding="async"
              />
              <div className="hero-carousel__content">
                {game.logoImageUrl ? (
                  <img
                    src={game.logoImageUrl}
                    width={250}
                    height={120}
                    alt={game.title}
                    className="hero-carousel__logo"
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                  />
                ) : (
                  <h2 className="hero-carousel__heading">{game.title}</h2>
                )}
                {game.description && (
                  <p className="hero-carousel__description">
                    {game.description}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="hero-carousel__arrow hero-carousel__arrow--prev"
        aria-label="Previous featured game"
        onClick={() => emblaApi?.scrollPrev()}
      >
        <ChevronLeftIcon size={20} />
      </button>
      <button
        type="button"
        className="hero-carousel__arrow hero-carousel__arrow--next"
        aria-label="Next featured game"
        onClick={() => emblaApi?.scrollNext()}
      >
        <ChevronRightIcon size={20} />
      </button>

      <div className="hero-carousel__dots">
        {games.map((game, index) => (
          <button
            key={game.uri}
            type="button"
            className={
              "hero-carousel__dot" +
              (index === selected ? " hero-carousel__dot--active" : "")
            }
            aria-label={`Go to featured game ${index + 1}`}
            onClick={() => emblaApi?.scrollTo(index)}
          />
        ))}
      </div>
    </section>
  );
}

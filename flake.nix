{
  description = "TypeScript/Bun project with CI setup";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            typescript
            just
            biome
            
            # Testing - Playwright browsers
            playwright-driver.browsers
          ];
          
          shellHook = ''
            echo "Yeet development environment"
            echo "Available commands:"
            echo "  just tui      - Run TUI"
            echo "  just web      - Run web UI (adapter mode)"
            echo "  just web-pty  - Run web UI (streaming mode)"
            echo "  just test     - Run tests"
            echo "  just test-web - Run Playwright tests"
            echo "  just ci       - Run CI checks"
            echo ""
            echo "Using Nix-provided tools:"
            echo "  Bun: $(bun --version)"
            echo "  TypeScript: $(tsc --version)"
            echo "  Playwright browsers: ${pkgs.playwright-driver.browsers}"
          '';
          
          # Tell Playwright to use Nix-provided browsers
          PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
        };
        
        apps.ci = {
          type = "app";
          program = "${pkgs.writeShellScript "ci" ''
            export PATH="${pkgs.lib.makeBinPath [
              pkgs.bun
              pkgs.biome
            ]}:$PATH"
            
            # Tell Playwright to use Nix-provided browsers
            export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
            
            exec ${./scripts/ci.sh}
          ''}";
        };
      });
}

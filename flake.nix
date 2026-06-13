{
  description = "markdown-reviewer — browser-based markdown annotation tool (mdr)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        version = "0.1.0";

        # ---------------------------------------------------------------------
        # Vendored node_modules.
        #
        # This is a fixed-output derivation: it is allowed network access to run
        # `bun install`, and its result is pinned by `outputHash`. If you change
        # dependencies (package.json / bun.lock), update the hash — Nix will
        # print the correct value on a mismatch, or run:
        #   nix build .#node_modules --rebuild
        # ---------------------------------------------------------------------
        node_modules = pkgs.stdenvNoCC.mkDerivation {
          pname = "markdown-reviewer-node_modules";
          inherit version;

          # Only the files that affect dependency resolution, so editing source
          # does not invalidate the vendored deps.
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./package.json
              ./bun.lock
              ./bunfig.toml
            ];
          };

          nativeBuildInputs = [ pkgs.bun ];

          dontConfigure = true;

          buildPhase = ''
            runHook preBuild
            export HOME=$TMPDIR
            bun install --frozen-lockfile --no-progress
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -R node_modules $out/node_modules
            runHook postInstall
          '';

          # Bun writes machine-specific absolute paths into some binary shims;
          # patch them out so the closure is reproducible.
          dontFixup = true;

          outputHashMode = "recursive";
          outputHashAlgo = "sha256";
          outputHash = "sha256-vFeM9Jg0/s82uFzr2Fy82iW7HH/zjeclabiYBjGoPgk=";
        };

        markdown-reviewer = pkgs.stdenvNoCC.mkDerivation {
          pname = "markdown-reviewer";
          inherit version;

          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./package.json
              ./bun.lock
              ./bunfig.toml
              ./tsconfig.json
              ./src
              ./public
            ];
          };

          nativeBuildInputs = [ pkgs.makeWrapper ];
          buildInputs = [ pkgs.bun ];

          dontConfigure = true;
          dontBuild = true;

          installPhase = ''
            runHook preInstall

            # App lives in libexec; assets are resolved relative to src/ via
            # import.meta.dir, so the layout (src/, public/) must be preserved.
            appdir=$out/libexec/markdown-reviewer
            mkdir -p "$appdir"
            cp -R src public package.json bun.lock bunfig.toml tsconfig.json "$appdir/"
            ln -s ${node_modules}/node_modules "$appdir/node_modules"

            makeWrapper ${pkgs.bun}/bin/bun $out/bin/mdr \
              --add-flags "run $appdir/src/cli/index.ts"

            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Browser-based markdown annotation tool";
            homepage = "https://github.com/matthewperron/markdown-reviewer";
            license = licenses.mit;
            mainProgram = "mdr";
            platforms = platforms.unix;
          };
        };
      in
      {
        packages = {
          inherit node_modules markdown-reviewer;
          default = markdown-reviewer;
        };

        apps.default = {
          type = "app";
          program = "${markdown-reviewer}/bin/mdr";
        };

        devShells.default = pkgs.mkShell {
          packages = [ pkgs.bun pkgs.nodejs ];
        };
      });
}

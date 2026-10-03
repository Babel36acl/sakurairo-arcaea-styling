<?php
/**
 * Plugin Name: Babel Arcaea Mermaid
 * Plugin URI: https://github.com/AKCX2002/sakurairo-arcaea-styling/tree/main/babel-arcaea-mermaid
 * Description: Render Mermaid diagrams in WordPress Markdown/code blocks with Arcaea/Sakurairo styled glassmorphism theme.
 * Version: 1.1.11
 * Author: Babel36acl
 * License: GPL-2.0-or-later
 * Text Domain: babel-arcaea-mermaid
 */

if (!defined('ABSPATH')) {
    exit;
}

define('BAM_VERSION', '1.1.11');
define('BAM_PLUGIN_URL', plugin_dir_url(__FILE__));
define('BAM_PLUGIN_DIR', plugin_dir_path(__FILE__));

/**
 * GitHub auto-updater — loaded on plugins_loaded.
 */
add_action('plugins_loaded', function () {
    $puc_file = BAM_PLUGIN_DIR . 'lib/plugin-update-checker.php';
    if (!file_exists($puc_file)) {
        return;
    }
    require_once $puc_file;
    $updateChecker = \YahnisElsts\PluginUpdateChecker\v5p7\PucFactory::buildUpdateChecker(
        'https://github.com/AKCX2002/sakurairo-arcaea-styling/',
        __FILE__,
        'babel-arcaea-mermaid'
    );
    $updateChecker->getVcsApi()->enableReleaseAssets();
    $token = getenv('GH_TOKEN') ?: getenv('GITHUB_TOKEN');
    if (!empty($token)) {
        try { $updateChecker->getVcsApi()->setAuthentication($token); }
        catch (\Exception $e) {}
    }
});

/**
 * Settings link on Plugins page.
 */
add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    $settings_link = '<a href="' . admin_url('options-general.php?page=babel-arcaea-mermaid') . '">设置</a>';
    array_unshift($links, $settings_link);
    return $links;
});

/**
 * Default options.
 */
function bam_default_options()
{
    return array(
        'enabled'          => 1,
        'load_mode'        => 'cdn',
        'mermaid_version'  => '12.0.0',
        'theme_mode'       => 'arcaea_dark',
        'security_level'   => 'strict',
        'enable_shortcode' => 1,
        'enable_codeblock' => 1,
        'enable_glow'      => 1,
        'force_full_width' => 1,
        'debug_mode'       => 0,
    );
}

function bam_get_options()
{
    $saved = get_option('bam_options', array());
    return wp_parse_args($saved, bam_default_options());
}

add_action('admin_init', function () {
    register_setting('bam_settings_group', 'bam_options', 'bam_sanitize_options');
});

function bam_sanitize_options($input)
{
    $defaults = bam_default_options();
    $output = array();
    $output['enabled'] = !empty($input['enabled']) ? 1 : 0;
    $allowed_load_modes = array('cdn');
    $output['load_mode'] = in_array($input['load_mode'] ?? '', $allowed_load_modes, true)
        ? $input['load_mode'] : $defaults['load_mode'];
    $allowed_versions = array('11.15.0', '11', '10.9.6', '11.17.2', '11.17', '12.0.0', '12.0');
    $output['mermaid_version'] = in_array($input['mermaid_version'] ?? '', $allowed_versions, true)
        ? $input['mermaid_version'] : $defaults['mermaid_version'];
    $allowed_theme_modes = array('arcaea_dark', 'arcaea_light', 'auto');
    $output['theme_mode'] = in_array($input['theme_mode'] ?? '', $allowed_theme_modes, true)
        ? $input['theme_mode'] : $defaults['theme_mode'];
    $allowed_security_levels = array('strict', 'loose', 'antiscript', 'sandbox');
    $output['security_level'] = in_array($input['security_level'] ?? '', $allowed_security_levels, true)
        ? $input['security_level'] : $defaults['security_level'];
    $output['enable_shortcode'] = !empty($input['enable_shortcode']) ? 1 : 0;
    $output['enable_codeblock'] = !empty($input['enable_codeblock']) ? 1 : 0;
    $output['enable_glow'] = !empty($input['enable_glow']) ? 1 : 0;
    $output['force_full_width'] = !empty($input['force_full_width']) ? 1 : 0;
    $output['debug_mode'] = !empty($input['debug_mode']) ? 1 : 0;
    return $output;
}

add_action('admin_menu', function () {
    add_options_page(
        'Babel Arcaea Mermaid',
        'Arcaea Mermaid',
        'manage_options',
        'babel-arcaea-mermaid',
        'bam_render_settings_page'
    );
});

function bam_render_settings_page()
{
    if (!current_user_can('manage_options')) { return; }
    $options = bam_get_options();
    ?>
    <div class="wrap">
        <h1>Babel Arcaea Mermaid</h1>
        <p>在 WordPress / Sakurairo / Githuber MD 中自动渲染 Mermaid 图表，并应用 Arcaea 风格的夜空、蓝白发光、毛玻璃视觉。</p>
        <form method="post" action="options.php">
            <?php settings_fields('bam_settings_group'); ?>
            <table class="form-table" role="presentation">
                <tr><th scope="row">启用插件</th><td><label><input type="checkbox" name="bam_options[enabled]" value="1" <?php checked($options['enabled'], 1); ?>> 启用 Mermaid 渲染</label></td></tr>
                <tr><th scope="row">Mermaid 版本</th><td><select name="bam_options[mermaid_version]">
                    <option value="11.15.0" <?php selected($options['mermaid_version'], '11.15.0'); ?>>11.15.0 推荐</option>
                    <option value="11" <?php selected($options['mermaid_version'], '11'); ?>>11.x 最新主版本</option>
                    <option value="10.9.6" <?php selected($options['mermaid_version'], '10.9.6'); ?>>10.9.6 LTS</option>
                </select><p class="description">推荐锁定 11.15.0，避免 @latest 不可控破坏。</p></td></tr>
                <tr><th scope="row">主题模式</th><td><select name="bam_options[theme_mode]">
                    <option value="arcaea_dark" <?php selected($options['theme_mode'], 'arcaea_dark'); ?>>Arcaea Dark / 夜空蓝白</option>
                    <option value="arcaea_light" <?php selected($options['theme_mode'], 'arcaea_light'); ?>>Arcaea Light / 浅色玻璃</option>
                    <option value="auto" <?php selected($options['theme_mode'], 'auto'); ?>>Auto / 跟随页面模式</option>
                </select></td></tr>
                <tr><th scope="row">安全等级</th><td><select name="bam_options[security_level]">
                    <option value="strict" <?php selected($options['security_level'], 'strict'); ?>>strict 推荐</option>
                    <option value="antiscript" <?php selected($options['security_level'], 'antiscript'); ?>>antiscript</option>
                    <option value="loose" <?php selected($options['security_level'], 'loose'); ?>>loose</option>
                    <option value="sandbox" <?php selected($options['security_level'], 'sandbox'); ?>>sandbox 最严格</option>
                </select></td></tr>
                <tr><th scope="row">Markdown 代码块</th><td><label><input type="checkbox" name="bam_options[enable_codeblock]" value="1" <?php checked($options['enable_codeblock'], 1); ?>> 自动识别 pre code.language-mermaid</label></td></tr>
                <tr><th scope="row">短代码</th><td><label><input type="checkbox" name="bam_options[enable_shortcode]" value="1" <?php checked($options['enable_shortcode'], 1); ?>> 启用 [mermaid]...[/mermaid]</label></td></tr>
                <tr><th scope="row">发光效果</th><td><label><input type="checkbox" name="bam_options[enable_glow]" value="1" <?php checked($options['enable_glow'], 1); ?>> 启用 Arcaea 蓝白辉光</label></td></tr>
                <tr><th scope="row">图表全宽</th><td><label><input type="checkbox" name="bam_options[force_full_width]" value="1" <?php checked($options['force_full_width'], 1); ?>> 强制 SVG 满宽</label></td></tr>
                <tr><th scope="row">调试模式</th><td><label><input type="checkbox" name="bam_options[debug_mode]" value="1" <?php checked($options['debug_mode'], 1); ?>> 输出日志到浏览器控制台</label></td></tr>
            </table>
            <?php submit_button(); ?>
        </form>
        <hr>
        <h2>使用示例</h2>
        <pre>```mermaid
flowchart TD
    A[WordPress] --> B[Githuber MD]
    B --> C[Mermaid]
    C --> D[Arcaea Style]
```</pre>
        <pre>[mermaid]
flowchart TD
    A[启动] --> B[初始化]
[/mermaid]</pre>
    </div>
    <?php
}

/* ============================================================
 * THE CORE FIX: PHP-level content filter replaces mermaid
 * code blocks BEFORE Prism ever sees the HTML.
 * No more JS DOM wrestling with autoloader race conditions.
 * ============================================================ */

/**
 * Convert <pre><code class="language-mermaid"> blocks to <div class="mermaid">
 * at the PHP content filter level.
 */
function bam_filter_content($content)
{
    $options = bam_get_options();
    if (empty($options['enabled']) || empty($options['enable_codeblock'])) {
        return $content;
    }

    // Match: <pre><code class="language-mermaid">CONTENT</code></pre>
    // Also match wp-block-preformatted variants
    $pattern = '/<pre[^>]*>\s*<code[^>]*class="[^"]*language-mermaid[^"]*"[^>]*>(.*?)<\/code>\s*<\/pre>/si';

    return preg_replace_callback($pattern, function ($matches) {
        $code = trim(html_entity_decode($matches[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if (empty($code)) {
            return $matches[0];
        }
        return '<div class="arcaea-mermaid-box"><div class="mermaid arcaea-mermaid-diagram">'
            . esc_html($code)
            . '</div></div>';
    }, $content);
}
add_filter('the_content', 'bam_filter_content', 1);
add_filter('the_excerpt', 'bam_filter_content', 1);

/* ============================================================
 * Shortcode
 * ============================================================ */

add_shortcode('mermaid', function ($atts, $content = null) {
    $options = bam_get_options();
    if (empty($options['enabled']) || empty($options['enable_shortcode'])) {
        return '';
    }
    $content = html_entity_decode((string) $content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $content = trim($content);
    if ($content === '') {
        return '';
    }
    return '<div class="arcaea-mermaid-box">'
        . '<div class="mermaid arcaea-mermaid-diagram">'
        . esc_html($content)
        . '</div>'
        . '</div>';
});

/* ============================================================
 * Enqueue CSS/JS
 * ============================================================ */

add_action('wp_enqueue_scripts', function () {
    if (is_admin()) { return; }
    $options = bam_get_options();
    if (empty($options['enabled'])) { return; }

    wp_enqueue_style(
        'babel-arcaea-mermaid-style',
        BAM_PLUGIN_URL . 'assets/arcaea-mermaid.css',
        array(),
        BAM_VERSION
    );

    wp_enqueue_script(
        'babel-arcaea-mermaid-script',
        BAM_PLUGIN_URL . 'assets/arcaea-mermaid.js',
        array(),
        BAM_VERSION,
        true
    );
});

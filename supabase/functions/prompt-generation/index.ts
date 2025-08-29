import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PromptTemplate {
  id: string
  category: 'discovery' | 'comparison' | 'recommendation' | 'technical' | 'review'
  base_template: string
  variants: string[]
  industry_specific: boolean
  difficulty_level: 'basic' | 'intermediate' | 'advanced'
}

interface GeneratePromptsRequest {
  brand_id: string
  categories?: string[]
  count_per_category?: number
  industry_focus?: string
  competitor_aware?: boolean
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { brand_id, categories = ['discovery', 'comparison', 'recommendation'], count_per_category = 5, industry_focus, competitor_aware = true }: GeneratePromptsRequest = await req.json()

    // Get brand details
    const { data: brand } = await supabase
      .from('brands')
      .select('*')
      .eq('id', brand_id)
      .single()

    if (!brand) {
      throw new Error('Brand not found')
    }

    // Get competitors if competitor_aware is true
    let competitors: any[] = []
    if (competitor_aware) {
      const { data: competitorData } = await supabase
        .from('competitors')
        .select('*')
        .eq('brand_id', brand_id)
        .limit(5)
      
      competitors = competitorData || []
    }

    // Base prompt templates by category
    const promptTemplates: Record<string, PromptTemplate[]> = {
      discovery: [
        {
          id: 'discovery-1',
          category: 'discovery',
          base_template: `I'm looking for solutions to help with {problem_area}. What are some good options available?`,
          variants: [
            `What are the best tools for {problem_area}?`,
            `Can you recommend software for {problem_area}?`,
            `I need help with {problem_area}. What do you suggest?`,
            `What solutions exist for {problem_area}?`,
            `Which companies offer {problem_area} services?`
          ],
          industry_specific: true,
          difficulty_level: 'basic'
        },
        {
          id: 'discovery-2',
          category: 'discovery',
          base_template: `I'm researching {industry} companies. What are some leading brands in this space?`,
          variants: [
            `Who are the top players in {industry}?`,
            `Which {industry} companies should I know about?`,
            `What are some innovative {industry} startups?`,
            `Can you list major {industry} brands?`,
            `Who dominates the {industry} market?`
          ],
          industry_specific: true,
          difficulty_level: 'intermediate'
        }
      ],
      comparison: [
        {
          id: 'comparison-1',
          category: 'comparison',
          base_template: `Compare {brand_name} vs {competitor_name} for {use_case}`,
          variants: [
            `{brand_name} or {competitor_name} - which is better for {use_case}?`,
            `What's the difference between {brand_name} and {competitor_name}?`,
            `Should I choose {brand_name} or {competitor_name}?`,
            `{brand_name} vs {competitor_name}: pros and cons`,
            `Which offers better value: {brand_name} or {competitor_name}?`
          ],
          industry_specific: false,
          difficulty_level: 'intermediate'
        },
        {
          id: 'comparison-2',
          category: 'comparison',
          base_template: `I'm deciding between {brand_name}, {competitor_name}, and {competitor_2}. Help me choose.`,
          variants: [
            `Compare {brand_name}, {competitor_name}, and {competitor_2}`,
            `Which is best: {brand_name}, {competitor_name}, or {competitor_2}?`,
            `Evaluate {brand_name} against {competitor_name} and {competitor_2}`,
            `Three-way comparison: {brand_name} vs {competitor_name} vs {competitor_2}`,
            `Help me pick between {brand_name}, {competitor_name}, and {competitor_2}`
          ],
          industry_specific: false,
          difficulty_level: 'advanced'
        }
      ],
      recommendation: [
        {
          id: 'recommendation-1',
          category: 'recommendation',
          base_template: `I need a {solution_type} for my {business_size} {industry} business. What do you recommend?`,
          variants: [
            `Best {solution_type} for {business_size} {industry} company?`,
            `Recommend a {solution_type} for {industry} business`,
            `What {solution_type} works best for {business_size} companies?`,
            `I run a {business_size} {industry} business and need {solution_type}`,
            `Suggest {solution_type} options for {industry} sector`
          ],
          industry_specific: true,
          difficulty_level: 'basic'
        },
        {
          id: 'recommendation-2',
          category: 'recommendation',
          base_template: `Looking for {solution_type} under ${budget} for {specific_requirement}`,
          variants: [
            `Best budget {solution_type} for {specific_requirement}?`,
            `Affordable {solution_type} options for {specific_requirement}`,
            `{solution_type} recommendations under ${budget}`,
            `Cost-effective {solution_type} for {specific_requirement}`,
            `Cheap but good {solution_type} for {specific_requirement}`
          ],
          industry_specific: false,
          difficulty_level: 'intermediate'
        }
      ],
      technical: [
        {
          id: 'technical-1',
          category: 'technical',
          base_template: `How do I integrate {brand_name} with {common_tool}?`,
          variants: [
            `{brand_name} {common_tool} integration guide`,
            `Connect {brand_name} to {common_tool}`,
            `API integration between {brand_name} and {common_tool}`,
            `Set up {brand_name} with {common_tool}`,
            `Link {brand_name} and {common_tool} systems`
          ],
          industry_specific: false,
          difficulty_level: 'advanced'
        },
        {
          id: 'technical-2',
          category: 'technical',
          base_template: `What are the system requirements for {brand_name}?`,
          variants: [
            `{brand_name} minimum requirements`,
            `Hardware needed for {brand_name}`,
            `{brand_name} compatibility requirements`,
            `System specs for {brand_name}`,
            `Technical prerequisites for {brand_name}`
          ],
          industry_specific: false,
          difficulty_level: 'basic'
        }
      ],
      review: [
        {
          id: 'review-1',
          category: 'review',
          base_template: `What do users think about {brand_name}? Is it worth it?`,
          variants: [
            `{brand_name} user reviews and ratings`,
            `Is {brand_name} any good?`,
            `{brand_name} customer feedback`,
            `Should I trust {brand_name}?`,
            `{brand_name} real user experiences`
          ],
          industry_specific: false,
          difficulty_level: 'basic'
        },
        {
          id: 'review-2',
          category: 'review',
          base_template: `{brand_name} pros and cons from actual users`,
          variants: [
            `{brand_name} advantages and disadvantages`,
            `What are {brand_name}'s strengths and weaknesses?`,
            `{brand_name} honest review`,
            `Good and bad points about {brand_name}`,
            `{brand_name} user satisfaction analysis`
          ],
          industry_specific: false,
          difficulty_level: 'intermediate'
        }
      ]
    }

    // Generate contextual replacements
    const replacements = {
      brand_name: brand.name,
      competitor_name: competitors[0]?.name || 'competitive solution',
      competitor_2: competitors[1]?.name || 'alternative option',
      industry: industry_focus || brand.industry || 'technology',
      problem_area: getProblemAreaForBrand(brand),
      use_case: getUseCaseForBrand(brand),
      solution_type: getSolutionTypeForBrand(brand),
      business_size: getRandomBusinessSize(),
      specific_requirement: getSpecificRequirement(brand),
      budget: getRandomBudget(),
      common_tool: getCommonTool(brand.industry || 'technology')
    }

    // Generate prompts
    const generatedPrompts: any[] = []
    let promptId = 1

    for (const category of categories) {
      const templates = promptTemplates[category] || []
      const promptsPerTemplate = Math.ceil(count_per_category / templates.length)

      for (const template of templates) {
        for (let i = 0; i < promptsPerTemplate && generatedPrompts.filter(p => p.category === category).length < count_per_category; i++) {
          const variant = template.variants[i % template.variants.length]
          const processedPrompt = replaceVariables(variant, replacements)

          generatedPrompts.push({
            id: `generated-${promptId++}`,
            brand_id,
            category: template.category,
            prompt_text: processedPrompt,
            template_id: template.id,
            difficulty_level: template.difficulty_level,
            industry_specific: template.industry_specific,
            expected_mention: shouldExpectMention(template.category),
            priority_score: calculatePriorityScore(template.category, template.difficulty_level),
            created_at: new Date().toISOString(),
            metadata: {
              template_base: template.base_template,
              replacements_used: Object.keys(replacements),
              competitor_aware: competitor_aware,
              industry_focus: industry_focus
            }
          })
        }
      }
    }

    // Store generated prompts
    const { error: insertError } = await supabase
      .from('brand_prompts')
      .insert(generatedPrompts.map(prompt => ({
        brand_id: prompt.brand_id,
        prompt_text: prompt.prompt_text,
        category: prompt.category,
        expected_mention: prompt.expected_mention,
        priority_score: prompt.priority_score,
        metadata: prompt.metadata
      })))

    if (insertError) {
      console.error('Error storing prompts:', insertError)
      // Continue anyway - we can still return the generated prompts
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        generated_count: generatedPrompts.length,
        prompts: generatedPrompts,
        categories_generated: categories,
        brand: {
          id: brand.id,
          name: brand.name,
          industry: brand.industry
        },
        competitors_used: competitors.slice(0, 2).map(c => ({ id: c.id, name: c.name }))
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Error in prompt generation:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// Helper functions
function replaceVariables(template: string, replacements: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(`{${key}}`, 'g'), value)
  }
  return result
}

function getProblemAreaForBrand(brand: any): string {
  const problemAreas = [
    'project management',
    'customer relationship management',
    'data analytics',
    'team collaboration',
    'marketing automation',
    'sales optimization',
    'workflow automation',
    'business intelligence',
    'customer support',
    'lead generation'
  ]
  return problemAreas[Math.floor(Math.random() * problemAreas.length)]
}

function getUseCaseForBrand(brand: any): string {
  const useCases = [
    'small business needs',
    'enterprise deployment',
    'startup requirements',
    'remote team management',
    'data-driven decisions',
    'customer acquisition',
    'process optimization',
    'team productivity',
    'business growth',
    'operational efficiency'
  ]
  return useCases[Math.floor(Math.random() * useCases.length)]
}

function getSolutionTypeForBrand(brand: any): string {
  const solutionTypes = [
    'CRM system',
    'analytics platform',
    'project management tool',
    'marketing platform',
    'collaboration software',
    'automation solution',
    'business intelligence tool',
    'customer support system',
    'sales platform',
    'productivity suite'
  ]
  return solutionTypes[Math.floor(Math.random() * solutionTypes.length)]
}

function getRandomBusinessSize(): string {
  const sizes = ['small', 'medium', 'large', 'enterprise', 'startup']
  return sizes[Math.floor(Math.random() * sizes.length)]
}

function getSpecificRequirement(brand: any): string {
  const requirements = [
    'multi-user access',
    'API integration',
    'mobile support',
    'advanced reporting',
    'custom workflows',
    'data security',
    'scalable architecture',
    'real-time analytics',
    'third-party integrations',
    'compliance requirements'
  ]
  return requirements[Math.floor(Math.random() * requirements.length)]
}

function getRandomBudget(): string {
  const budgets = ['$100/month', '$500/month', '$1000/month', '$5000/month', '$10000']
  return budgets[Math.floor(Math.random() * budgets.length)]
}

function getCommonTool(industry: string): string {
  const toolsByIndustry: Record<string, string[]> = {
    technology: ['Slack', 'GitHub', 'Jira', 'Salesforce', 'AWS'],
    finance: ['QuickBooks', 'Excel', 'SAP', 'Tableau', 'PowerBI'],
    marketing: ['HubSpot', 'Mailchimp', 'Google Analytics', 'Facebook Ads', 'Zapier'],
    healthcare: ['Epic', 'Cerner', 'Salesforce Health Cloud', 'Microsoft Teams', 'Zoom'],
    default: ['Slack', 'Microsoft Teams', 'Google Workspace', 'Zoom', 'Salesforce']
  }
  
  const tools = toolsByIndustry[industry] || toolsByIndustry.default
  return tools[Math.floor(Math.random() * tools.length)]
}

function shouldExpectMention(category: string): boolean {
  // Categories more likely to mention the brand
  const highMentionCategories = ['comparison', 'review', 'technical']
  return highMentionCategories.includes(category)
}

function calculatePriorityScore(category: string, difficulty: string): number {
  const categoryScores = {
    discovery: 85,
    comparison: 95,
    recommendation: 90,
    technical: 70,
    review: 80
  }
  
  const difficultyMultipliers = {
    basic: 1.0,
    intermediate: 1.1,
    advanced: 1.2
  }
  
  const baseScore = categoryScores[category as keyof typeof categoryScores] || 75
  const multiplier = difficultyMultipliers[difficulty as keyof typeof difficultyMultipliers] || 1.0
  
  return Math.round(baseScore * multiplier)
}